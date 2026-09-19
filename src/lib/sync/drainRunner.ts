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
 *            stale_base ──▶ halt (CONFLICT; F1-5a resolves it)
 *            fatal ───────▶ halt until the author saves something new
 *
 * Constitution rules this file has to keep:
 *   - No silent last-write-wins: `stale_base` halts the runner. It is never
 *     retried, and nothing here resolves a conflict on the author's behalf.
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
import type { SyncEvent } from "@/domain/sync/states";
import type { DocumentTransaction } from "@/domain/document";

import type { JournalDb } from "@/lib/journal/db";
import { clearPending, loadJournal, markSynced } from "@/lib/journal/journal";

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

      // No retry from here. `stale_base` is a conflict the author has to
      // resolve; everything else would fail identically on the next attempt.
      halted = outcome.status === "stale_base" ? "conflict" : "fatal";
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

  function stop(): void {
    stopped = true;
    clearTimer();
  }

  // Drain what a previous session left behind.
  schedule("debounce", debounceMs);

  return { notifyLocalSave, stop };
}
