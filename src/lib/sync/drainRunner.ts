"use client";

/**
 * The pending-queue drain (F1-4b): the one thing in the client that moves a
 * document from LOCAL_DURABLE to SYNCED.
 *
 * Plain module, no React. The editor owns a runner, feeds it two signals
 * (`notifyLocalSave`, `stop`) and takes everything else back through the
 * callbacks it passed in. That keeps the whole loop testable with a fake
 * IndexedDB and a stub `commit`, with no component tree and no network.
 *
 * All the decisions live in `@/domain/sync/drain`; this file only performs
 * them. What it adds is the things a pure function cannot have: a clock, a
 * single-flight latch, and the journal writes an ACK implies.
 *
 * The shape of one tick:
 *
 *      notifyLocalSave() ──debounce 1s──▶ tick
 *                                          │
 *                       loadJournal ──▶ planDrain ──▶ nothing? stop
 *                                          │
 *                       SYNC_STARTED ──▶ commit(tx) ──▶ outcomeToEvents
 *                                          │
 *            ACK ───▶ clearPending ▶ markSynced ▶ onServerRevision
 *            retryable ───▶ wait nextAttemptDelayMs, tick again
 *            stale_base ──▶ fetchServer ▶ recordConflict ▶ halt (CONFLICT)
 *            fatal ───────▶ halt until the author saves something new
 *
 * Constitution rules this file has to keep:
 *   - No silent last-write-wins: `stale_base` records a conflict (both
 *     versions, kept) and halts the runner. It is never retried, nothing here
 *     resolves a conflict on the author's behalf, and the halt is lifted only
 *     by `resumeAfterConflict` — that is, by an explicit decision.
 *   - Local durable state is not canonical server state: the journal's base
 *     revision moves only on an ACK, and only to the number the server named.
 *   - Never a generic "saved": the runner emits the machine's own events and
 *     lets the chip do the talking; `markSynced` refuses to record SYNCED
 *     while rows are still owed.
 */

import {
  ackedRevision as revisionOf,
  fastForwardBase,
  isRetryable,
  nextAttemptDelayMs,
  outcomeToEvents,
  planDrain,
  type DrainOutcome,
} from "@/domain/sync/drain";
import { buildConflictRecord } from "@/domain/sync/conflict";
import type { SyncEvent } from "@/domain/sync/states";
import type { DocumentTransaction } from "@/domain/document";

import type { JournalDb } from "@/lib/journal/db";
import {
  clearPending,
  loadJournal,
  markSynced,
  recordConflict,
  type FetchServerFn,
  type ServerSide,
} from "@/lib/journal/journal";

/**
 * How long a burst of local saves is allowed to coalesce before the queue is
 * drained.
 *
 * This is a *leading-edge* schedule, not a resetting debounce: the tick is
 * booked one second after the first save of a burst and further saves inside
 * that second are absorbed. A resetting debounce would mean an author who
 * types continuously never syncs at all, which is precisely the failure the
 * eight states exist to make impossible to hide.
 */
export const DRAIN_DEBOUNCE_MS = 1_000;

/** Cancels a scheduled callback. Idempotent by contract. */
export type CancelFn = () => void;

/** Schedules `fn` after `ms`. Injectable so tests need no real timers. */
export type DelayFn = (ms: number, fn: () => void) => CancelFn;

/**
 * Sends one transaction and reports what the server said.
 *
 * Production wires this to the `commitDocument` server action. It must not
 * throw: a rejected round trip is `{ status: 'transport_error' }`, which is
 * the only retryable outcome. The runner catches anyway, because a `commit`
 * that throws must not leave the latch stuck.
 */
export type CommitFn = (tx: DocumentTransaction) => Promise<DrainOutcome>;

export type DrainRunnerOptions = {
  db: JournalDb;
  /** Journal key. The same id `saveLocal` writes under. */
  documentId: string;
  commit: CommitFn;
  /** The editor's `useReducer` dispatch, or any sink for sync events. */
  dispatch: (event: SyncEvent) => void;
  /** Called with each revision the server acknowledges, newest last. */
  onServerRevision: (revision: number) => void;
  /**
   * Reads the canonical server document, for the conflict record (F1-5a).
   *
   * Optional, and allowed to fail: when it is missing or comes back empty the
   * conflict is still recorded, with `serverDocument: null`. A conflict the
   * author is never told about would be the worse failure by far.
   */
  fetchServer?: FetchServerFn;
  delayFn?: DelayFn;
  /** Jitter source for the backoff, in [0, 1). */
  jitterFn?: () => number;
  debounceMs?: number;
};

export type DrainRunner = {
  /**
   * Tell the runner a local save just became durable. Cheap and idempotent:
   * calling it on every LOCAL_SAVE_OK is the intended usage.
   */
  notifyLocalSave: () => void;
  /**
   * Lift the conflict halt after the author has explicitly resolved it
   * (F1-5a).
   *
   * This is the ONLY way out of `halted === 'conflict'`, and it exists so that
   * the exit is impossible to take by accident: a new local save must not
   * resume the drain while a conflict is open, because that would resolve the
   * conflict by force. A no-op unless the runner is actually halted on a
   * conflict.
   */
  resumeAfterConflict: () => void;
  /** Cancel every timer and ignore every answer still in flight. */
  stop: () => void;
};

/**
 * Why the runner is not draining any more.
 *
 * 'conflict' is permanent for this runner: leaving CONFLICT takes an explicit
 * decision by the author (F1-5a), and another local save is not one — the
 * whole point of the state is that the author is asked before anything is
 * overwritten.
 *
 * 'fatal' is cleared by the next local save. A document the server refused as
 * too large, or a payload it could not read, may well be sendable once the
 * author has changed it; what must not happen is a retry loop over the exact
 * same bytes, and requiring a new save is what prevents that.
 */
type Halt = "conflict" | "fatal" | null;

function defaultDelay(ms: number, fn: () => void): CancelFn {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
}

/**
 * Creates a drain runner for one document.
 *
 * Only the tab holding the writer lock may own one: a second tab draining the
 * same journal would race the first for the same pending rows. The caller
 * enforces that (the editor passes a journal only when it is the writer), and
 * the server's CAS is the backstop if it ever slips.
 *
 * A tick is booked immediately on creation, so a session that opens with rows
 * left over from a previous visit (a reload, a crash, an offline stretch)
 * drains them without waiting for the author to type again.
 */
export function createDrainRunner({
  db,
  documentId,
  commit,
  dispatch,
  onServerRevision,
  fetchServer,
  delayFn = defaultDelay,
  jitterFn = Math.random,
  debounceMs = DRAIN_DEBOUNCE_MS,
}: DrainRunnerOptions): DrainRunner {
  let stopped = false;
  /** Cancels whatever tick is currently booked, if any. */
  let cancelTimer: CancelFn | null = null;
  /** What the booked tick is: a coalesced burst, or a backoff retry. */
  let booked: "debounce" | "retry" | null = null;
  /** Single-flight latch: at most one round trip is in the air. */
  let running = false;
  /** A local save arrived while a tick was running; drain again after it. */
  let again = false;
  /** Consecutive retryable failures. Reset by an ACK or by a new local save. */
  let attempt = 0;
  /** The newest revision the SERVER acknowledged to THIS runner. */
  let acked: number | null = null;
  let halted: Halt = null;

  function clearTimer(): void {
    if (cancelTimer) {
      cancelTimer();
    }
    cancelTimer = null;
    booked = null;
  }

  function schedule(kind: "debounce" | "retry", ms: number): void {
    if (stopped || halted !== null) {
      return;
    }
    if (booked === kind) {
      // Already booked for the same reason: absorb. This is what turns a
      // burst of local saves into one tick.
      return;
    }
    if (booked === "debounce" && kind === "retry") {
      // A save landed while the failed attempt was being scheduled; the
      // sooner, content-driven tick wins.
      return;
    }
    // A new local save must not sit behind a 30-second backoff.
    clearTimer();
    booked = kind;
    cancelTimer = delayFn(ms, () => {
      cancelTimer = null;
      booked = null;
      void tick();
    });
  }

  /** Never throws: a `commit` that rejects is a transport failure, not a crash. */
  async function commitSafely(tx: DocumentTransaction): Promise<DrainOutcome> {
    try {
      return await commit(tx);
    } catch {
      return { status: "transport_error" };
    }
  }

  /**
   * Records an ACK: the acknowledged prefix leaves the queue, then the journal
   * takes the server's revision.
   *
   * That order is deliberate. `markSynced` decides between SYNCED and
   * LOCAL_DURABLE by what is still queued, so it has to run after the prefix
   * is gone or it would never see an empty queue. A failure of either write is
   * not escalated: the server has the content, and the next tick re-reads the
   * journal — at worst the row is replayed and comes back `duplicate`, which
   * is an ACK again.
   */
  /** Reads the server's version for the conflict record. Never throws. */
  async function fetchServerSafely(): Promise<ServerSide | null> {
    if (!fetchServer) {
      return null;
    }
    try {
      return await fetchServer();
    } catch {
      // A throwing read tells us nothing about the server; it is the same
      // situation as one that answered "no".
      return null;
    }
  }

  /**
   * Records the conflict a refused compare-and-set just revealed (F1-5a).
   *
   * Runs BEFORE `SYNC_STALE_BASE` is dispatched, and that order is the point:
   * the moment the state machine says CONFLICT, the UI stops the author and
   * asks them to choose, and a decision offered without the evidence behind it
   * having been written down is a decision that a crash can erase. The row is
   * written first; the claim comes second.
   *
   * `tx` is the transaction the server refused — the author's own document and
   * the base that turned out to be stale — so the record needs no extra input
   * from the caller. When the server's version cannot be fetched the conflict
   * is recorded with `serverDocument: null` and `serverRevision` taken from the
   * refusal itself, which always carries the server's current revision. Such a
   * conflict can be rebased but not discarded until a later fetch fills it in
   * (`refreshConflictServerSide`).
   *
   * A journal that refuses the write is not escalated here: the state machine
   * must still reach CONFLICT, because halting silently would leave the author
   * looking at a document that is quietly no longer being synced.
   */
  async function recordStaleBase(
    tx: DocumentTransaction,
    currentRevision: number,
  ): Promise<void> {
    const server = await fetchServerSafely();
    await recordConflict(
      db,
      buildConflictRecord({
        documentId,
        localDocument: tx.document,
        localBaseRevision: tx.baseRevision,
        serverDocument: server?.document ?? null,
        serverRevision: server?.revision ?? currentRevision,
      }),
    );
  }

  async function recordAck(upToSeq: number, revision: number): Promise<void> {
    await clearPending(db, documentId, upToSeq);
    await markSynced(db, documentId, revision);
    if (!stopped) {
      onServerRevision(revision);
    }
  }

  async function tick(): Promise<void> {
    if (stopped || running || halted !== null) {
      return;
    }
    running = true;
    again = false;

    try {
      const loaded = await loadJournal(db, documentId);
      if (stopped) {
        return;
      }
      if (!loaded.ok) {
        // The journal could not be read. That is a LOCAL failure, and it is
        // the local save path's to report (LOCAL_SAVE_FAILED / recovery):
        // claiming SYNC_FAILED here would blame the server for a store that
        // is unreadable. Back off and look again.
        attempt += 1;
        schedule("retry", nextAttemptDelayMs(attempt, jitterFn));
        return;
      }

      const plan = planDrain(loaded.contents.pending, loaded.contents.meta);
      if (plan.send === null) {
        // Nothing is owed (or the document is in a state that must not be
        // drained). Stop; `notifyLocalSave` starts the loop again.
        return;
      }

      const tx = fastForwardBase(plan.send.tx, acked);

      dispatch({ type: "SYNC_STARTED" });
      const outcome = await commitSafely(tx);
      if (stopped) {
        return;
      }

      // A refused CAS is the one outcome with work to do BEFORE the state
      // machine hears about it: the conflict is written to the journal first,
      // so what the author is about to be asked about survives a crash.
      if (outcome.status === "stale_base") {
        await recordStaleBase(tx, outcome.currentRevision);
        if (stopped) {
          return;
        }
        for (const event of outcomeToEvents(outcome)) {
          dispatch(event);
        }
        halted = "conflict";
        return;
      }

      for (const event of outcomeToEvents(outcome)) {
        dispatch(event);
      }

      const revision = revisionOf(outcome);
      if (revision !== null) {
        attempt = 0;
        acked = revision;
        await recordAck(plan.send.localSeq, revision);
        return;
      }

      if (isRetryable(outcome)) {
        attempt += 1;
        schedule("retry", nextAttemptDelayMs(attempt, jitterFn));
        return;
      }

      // No retry from here: everything left would fail identically on the
      // next attempt. (`stale_base` returned above, with its conflict
      // recorded.)
      halted = "fatal";
    } finally {
      running = false;
      // A save landed mid-tick: newer content than whatever just failed, so a
      // fatal answer about the old bytes must not bury it. A conflict still
      // waits for the author — typing is not a resolution.
      if (again && halted === "fatal") {
        halted = null;
        attempt = 0;
      }
      // A save that landed mid-tick, or a queue that still has newer rows
      // after an ACK: go round once more.
      if (again && !stopped && halted === null) {
        schedule("debounce", debounceMs);
      }
    }
  }

  function notifyLocalSave(): void {
    if (stopped) {
      return;
    }
    // New content deserves a fresh budget — and a document that failed for a
    // reason a new save can fix is worth trying again.
    attempt = 0;
    if (halted === "fatal") {
      halted = null;
    }
    if (halted !== null) {
      return;
    }
    if (running) {
      again = true;
      return;
    }
    schedule("debounce", debounceMs);
  }

  /**
   * The author has chosen rebase or discard, so the queue may move again.
   *
   * Deliberately separate from `notifyLocalSave`: typing is not a resolution,
   * and the only thing that may lift this halt is a decision that was actually
   * made. After a rebase the queue holds the re-based document and the drain
   * sends it; after a discard the queue is empty and the tick finds nothing,
   * which is exactly right.
   */
  function resumeAfterConflict(): void {
    if (stopped || halted !== "conflict") {
      return;
    }
    halted = null;
    attempt = 0;
    schedule("debounce", debounceMs);
  }

  function stop(): void {
    stopped = true;
    clearTimer();
  }

  // Drain what a previous session left behind.
  schedule("debounce", debounceMs);

  return { notifyLocalSave, resumeAfterConflict, stop };
}
