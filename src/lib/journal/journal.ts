/**
 * Local durable journal operations (F1-3a).
 *
 * The one rule this module exists to enforce (dossier §7): a local save writes
 * the snapshot, the pending transaction, the local sequence and the sync state
 * in ONE IndexedDB transaction, or it writes none of them. Dexie aborts the
 * whole `db.transaction('rw', ...)` scope on any error inside it, so a failed
 * save leaves the journal exactly as it was — the author's previous durable
 * state is never half-overwritten by a newer one.
 *
 * What is stored is a debounced canonical candidate, not keystrokes: the
 * constitution forbids per-keystroke logging, and the editor only projects a
 * candidate once the author stops typing.
 *
 * Nothing here talks to the server. Local durability is not canonical server
 * state, and no function in this file advances a revision — only a server ACK
 * does (F1-4a).
 *
 * KNOWN LIMITATION (multi-tab). IndexedDB is shared by every tab on the
 * origin, and `saveLocal` replaces the snapshot row outright. Two tabs editing
 * the same document would therefore overwrite each other's snapshot with no
 * conflict ever being raised — a silent last-write-wins, which the
 * constitution forbids. The callers guard this with a single-writer Web Lock
 * (`acquireDocumentLock`, `lock.ts`): only the tab holding the lock journals.
 * Where the Web Locks API is missing the guard degrades to "write anyway",
 * because refusing to save would lose the author's text outright; that
 * fallback is the residual gap and it closes properly in F1-4b, when the
 * server CAS gives the second tab a real stale-base conflict instead.
 */

import type { CanonicalDocument } from "@/domain/document";
import type { DocumentTransaction } from "@/domain/document";
import { documentsEqual } from "@/domain/document";
import {
  buildConflictRecord,
  isResolvedConflict,
  type ConflictRecord,
} from "@/domain/sync/conflict";
import type {
  JournalContents,
  PendingTransaction,
  SyncMeta,
} from "@/domain/sync/journal-types";
import type {
  ConflictResolution,
  LocalSaveFailureReason,
  SyncState,
} from "@/domain/sync/states";

import { classifyJournalError, type JournalDb } from "./db";

/**
 * Why a local write was refused rather than attempted.
 *
 * 'state-locked' is not a storage failure: the journal is FROZEN because the
 * document is in one of the two sticky states (CONFLICT, RECOVERY_REQUIRED),
 * each of which may only be left by an explicit decision. A candidate landing
 * there would overwrite `meta.state` with LOCAL_DURABLE — quietly cancelling
 * the conflict, resuming the drain and committing over the very revision the
 * author was being asked about. It is kept out of `LocalSaveFailureReason` on
 * purpose: it must never reach `LOCAL_SAVE_FAILED`, because nothing failed.
 */
export const JOURNAL_FROZEN = "state-locked";

export type LocalWriteFailure = LocalSaveFailureReason | typeof JOURNAL_FROZEN;

export type SaveLocalResult =
  | { ok: true; localSeq: number }
  | { ok: false; reason: LocalWriteFailure };

export type LoadJournalResult =
  | { ok: true; contents: JournalContents }
  | { ok: false; reason: LocalSaveFailureReason };

export type ClearPendingResult =
  | { ok: true; cleared: number }
  | { ok: false; reason: LocalSaveFailureReason };

export type MarkStateResult =
  | { ok: true; meta: SyncMeta }
  | { ok: false; reason: LocalSaveFailureReason };

export type MarkSyncedResult =
  | { ok: true; meta: SyncMeta; revision: number }
  | { ok: false; reason: LocalSaveFailureReason };

export type ConflictResult =
  | { ok: true; conflict: ConflictRecord | null }
  | { ok: false; reason: LocalSaveFailureReason };

export type AdoptServerDocumentResult =
  | { ok: true; meta: SyncMeta; cleared: number; revision: number }
  | { ok: false; reason: LocalSaveFailureReason };

/** A document as the server holds it, with the revision the server named. */
export type ServerSide = {
  document: CanonicalDocument;
  revision: number;
};

/**
 * Reads the canonical server document. Injected, never implemented here: this
 * module must stay ignorant of Supabase, of server actions and of the network.
 * Returns `null` when the read did not come back — that is a fact about the
 * round trip, not an exception to be thrown at a journal.
 */
export type FetchServerFn = () => Promise<ServerSide | null>;

/**
 * How many pending rows one document may keep.
 *
 * Without a server there is nothing to acknowledge, so the queue would grow
 * once per debounce interval for as long as the author writes and eventually
 * exhaust the origin's quota — turning every later save into a 'quota' ERROR.
 * `saveLocal` therefore trims the oldest rows inside the same transaction, so
 * the trim is as atomic as the write it belongs to.
 *
 * Dropping the oldest entries is safe precisely because F1-3a has no sync:
 * nothing downstream reads them yet. From F1-4b the queue is cleared by ACK
 * (`clearPending`) and this cap becomes a backstop rather than the mechanism.
 */
export const PENDING_LIMIT = 50;

function defaultUuid(): string {
  return crypto.randomUUID();
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * The two states that FREEZE the journal.
 *
 * Both may only be left by an explicit decision (`CONFLICT_RESOLVED`,
 * `RECOVERED`), so an ordinary candidate must not be written while either is
 * recorded: the write would replace `meta.state` with LOCAL_DURABLE and the
 * decision the author still owes would simply evaporate.
 */
const FROZEN_STATES: readonly SyncState[] = ["CONFLICT", "RECOVERY_REQUIRED"];

/** Thrown inside the write transaction to abort it; never escapes this file. */
class JournalFrozenError extends Error {
  constructor() {
    super("journal is frozen by a sticky sync state");
    this.name = "JournalFrozenError";
  }
}

/**
 * True when a rejection is our own freeze marker, however Dexie wrapped it.
 * The chain is walked with a hard bound, like `classifyJournalError`, because
 * a cyclic `cause` must not hang the save path.
 */
function isFrozenError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    if (current instanceof JournalFrozenError) {
      return true;
    }
    const link = current as { name?: unknown; inner?: unknown; cause?: unknown };
    if (link.name === "JournalFrozenError") {
      return true;
    }
    current = link.inner ?? link.cause ?? null;
  }
  return false;
}

/**
 * Writes one canonical candidate to the journal, atomically.
 *
 * Builds the F1 transaction (`REPLACE_DOCUMENT`, a fresh client transaction id
 * for the `(document, actor, clientTransactionId)` idempotency key) and then,
 * inside a single `rw` transaction:
 *   1. checks the journal is not frozen (see `FROZEN_STATES`),
 *   2. replaces the snapshot,
 *   3. appends a pending row at `meta.localSeq + 1`,
 *   4. updates meta (local sequence + sync state).
 *
 * The recorded state is LOCAL_DURABLE, never SYNCED: this function has not
 * spoken to a server and must not imply that it has.
 *
 * Step 1 is the backstop for the UI's own guards. A candidate can be in flight
 * when a conflict is raised — the editor goes read-only a beat later, and a
 * debounced projection may already be on its way — and letting it land would
 * be a silent last-write-wins spread over two events: the conflict would be
 * gone from `meta`, the panel would not come back on reload, and the drain
 * would resume against the revision the author never chose. The check lives
 * INSIDE the transaction so it cannot be raced by a concurrent resolution.
 * `rebaseLocal` is the one write that may cross this line, because it IS the
 * decision.
 *
 * `uuidFn` and `nowFn` are injectable so tests and replay tooling stay
 * deterministic; `nowFn` is the small deviation from a pure domain call — the
 * journal is the layer that is allowed to read a clock.
 *
 * Failures are mapped to the reducer's `LOCAL_SAVE_FAILED` reasons rather than
 * thrown, so the caller's next dispatch is a plain state transition. A refusal
 * ('state-locked') is deliberately NOT one of them: nothing failed.
 */
export async function saveLocal(
  db: JournalDb,
  documentId: string,
  candidate: CanonicalDocument,
  baseRevision: number,
  uuidFn: () => string = defaultUuid,
  nowFn: () => string = defaultNow,
): Promise<SaveLocalResult> {
  return writeCandidate(db, documentId, candidate, baseRevision, uuidFn, nowFn, false);
}

/**
 * The journal write of an explicit REBASE (F1-5a): my document, re-based onto
 * the revision the server named, queued for the drain.
 *
 * Identical to `saveLocal` in every respect but one: it is allowed to write
 * while the journal is frozen in CONFLICT, because it is the author's decision
 * to leave that state rather than something that would quietly cancel it. That
 * is also why it is a separate, loudly named function instead of a boolean on
 * `saveLocal` — the exception should be impossible to take by accident.
 */
export async function rebaseLocal(
  db: JournalDb,
  documentId: string,
  document: CanonicalDocument,
  serverRevision: number,
  uuidFn: () => string = defaultUuid,
  nowFn: () => string = defaultNow,
): Promise<SaveLocalResult> {
  return writeCandidate(db, documentId, document, serverRevision, uuidFn, nowFn, true);
}

async function writeCandidate(
  db: JournalDb,
  documentId: string,
  candidate: CanonicalDocument,
  baseRevision: number,
  uuidFn: () => string,
  nowFn: () => string,
  resolvesConflict: boolean,
): Promise<SaveLocalResult> {
  let tx: DocumentTransaction;
  try {
    tx = {
      kind: "REPLACE_DOCUMENT",
      clientTransactionId: uuidFn(),
      baseRevision,
      document: candidate,
      createdAt: nowFn(),
    };
  } catch (error) {
    // A generator that throws (no CSPRNG in this environment) is an
    // environment failure, not a storage failure — classify it, do not crash.
    return { ok: false, reason: classifyJournalError(error) };
  }

  try {
    const localSeq = await db.transaction(
      "rw",
      db.snapshots,
      db.pending,
      db.meta,
      async () => {
        const current = await db.meta.get(documentId);
        if (
          !resolvesConflict &&
          current &&
          FROZEN_STATES.includes(current.state)
        ) {
          // Aborts the whole transaction: nothing at all is written.
          throw new JournalFrozenError();
        }
        const nextSeq = (current?.localSeq ?? 0) + 1;

        await db.snapshots.put({
          documentId,
          // The base revision the candidate was derived from. The candidate
          // itself has no server revision until an ACK assigns one.
          revision: baseRevision,
          document: candidate,
          savedAt: tx.createdAt,
        });

        await db.pending.put({
          documentId,
          localSeq: nextSeq,
          tx,
          queuedAt: tx.createdAt,
        });

        // `lastError` is dropped: this write succeeded, so a stale reason must
        // not linger and make a healthy journal look broken.
        await db.meta.put({
          documentId,
          state: "LOCAL_DURABLE" satisfies SyncState,
          localSeq: nextSeq,
        });

        // Same transaction as the append: the queue is never observed over
        // its cap, and a failed trim rolls the whole save back rather than
        // leaving a snapshot whose queue was half-pruned.
        const keys = await db.pending.where("documentId").equals(documentId).primaryKeys();
        if (keys.length > PENDING_LIMIT) {
          // Index order follows `documentId`, not the sequence, so sort before
          // deciding which rows are the oldest.
          const oldest = [...keys]
            .sort((a, b) => a[1] - b[1])
            .slice(0, keys.length - PENDING_LIMIT);
          await db.pending.bulkDelete(oldest);
        }

        return nextSeq;
      },
    );

    return { ok: true, localSeq };
  } catch (error) {
    if (isFrozenError(error)) {
      return { ok: false, reason: JOURNAL_FROZEN };
    }
    return { ok: false, reason: classifyJournalError(error) };
  }
}

/**
 * Reads everything the journal holds for one document: snapshot, the pending
 * queue (ascending by `localSeq`) and meta. Read in one `readonly`
 * transaction so the three cannot be observed mid-write and disagree.
 */
export async function loadJournal(
  db: JournalDb,
  documentId: string,
): Promise<LoadJournalResult> {
  try {
    const contents = await db.transaction(
      "r",
      db.snapshots,
      db.pending,
      db.meta,
      async (): Promise<JournalContents> => {
        const [snapshot, pending, meta] = await Promise.all([
          db.snapshots.get(documentId),
          db.pending.where("documentId").equals(documentId).sortBy("localSeq"),
          db.meta.get(documentId),
        ]);

        return {
          snapshot: snapshot ?? null,
          pending: pending as PendingTransaction[],
          meta: meta ?? null,
        };
      },
    );

    return { ok: true, contents };
  } catch (error) {
    return { ok: false, reason: classifyJournalError(error) };
  }
}

/**
 * Drops pending rows up to and including `upToSeq` — what a server ACK for
 * that sequence makes redundant (used from F1-4b).
 *
 * Only the acknowledged prefix goes: rows queued after the ACK still owe the
 * server and dropping them would be a silent loss of the author's newest work.
 * `meta.localSeq` is deliberately left alone; it is a high-water mark, and
 * reusing sequence numbers would break the idempotency key's ordering.
 */
export async function clearPending(
  db: JournalDb,
  documentId: string,
  upToSeq: number,
): Promise<ClearPendingResult> {
  try {
    const cleared = await db.transaction("rw", db.pending, async () => {
      const keys = await db.pending
        .where("documentId")
        .equals(documentId)
        .filter((row) => row.localSeq <= upToSeq)
        .primaryKeys();

      await db.pending.bulkDelete(keys);
      return keys.length;
    });

    return { ok: true, cleared };
  } catch (error) {
    return { ok: false, reason: classifyJournalError(error) };
  }
}

/**
 * Records a server ACK in the journal, atomically (F1-4b).
 *
 * Two facts land together, or neither does:
 *   1. the snapshot's base revision becomes `revision` — the revision the
 *      server just assigned to those bytes;
 *   2. `meta.state` records that the ACK happened.
 *
 * This is the ONLY function in this file that writes a revision, and it does
 * not invent one: `revision` comes from the server's `committed`/`duplicate`
 * answer and from nowhere else. Local durable state is still not canonical
 * server state — this is the moment the two are allowed to agree.
 *
 * The recorded state is SYNCED only when the queue is empty. If the author
 * kept typing while the commit was in flight, rows newer than the acknowledged
 * one are still owed to the server, and calling that SYNCED would be the
 * generic "saved" the constitution forbids — LOCAL_DURABLE is the honest
 * claim, and the drain will come back for the rest. Callers therefore run
 * `clearPending` for the acknowledged prefix BEFORE this.
 *
 * A document with no snapshot row (nothing was ever journalled locally) still
 * gets its meta written; there is simply no revision to place.
 */
export async function markSynced(
  db: JournalDb,
  documentId: string,
  revision: number,
): Promise<MarkSyncedResult> {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    // A revision that is not a whole, safe number cannot be compared against
    // on the next CAS, so it is refused rather than stored.
    return { ok: false, reason: "unknown" };
  }

  try {
    const meta = await db.transaction(
      "rw",
      db.snapshots,
      db.pending,
      db.meta,
      async () => {
        const snapshot = await db.snapshots.get(documentId);
        if (snapshot) {
          await db.snapshots.put({ ...snapshot, revision });
        }

        const outstanding = await db.pending
          .where("documentId")
          .equals(documentId)
          .count();

        const current = await db.meta.get(documentId);
        const next: SyncMeta = {
          documentId,
          state: (outstanding === 0 ? "SYNCED" : "LOCAL_DURABLE") satisfies SyncState,
          localSeq: current?.localSeq ?? 0,
        };
        await db.meta.put(next);
        return next;
      },
    );

    return { ok: true, meta, revision };
  } catch (error) {
    return { ok: false, reason: classifyJournalError(error) };
  }
}

/**
 * Records the sync state for a document without touching the snapshot or the
 * queue — used when the state changes for a reason that is not a local write
 * (a sync attempt, a conflict, a recovery).
 *
 * `lastError` is written when given and cleared when omitted, so a document
 * that recovers does not keep displaying an old failure reason. The local
 * sequence is preserved: this function never mints one.
 */
export async function markState(
  db: JournalDb,
  documentId: string,
  state: SyncState,
  lastError?: LocalSaveFailureReason,
): Promise<MarkStateResult> {
  try {
    const meta = await db.transaction("rw", db.meta, async () => {
      const current = await db.meta.get(documentId);
      const next: SyncMeta = {
        documentId,
        state,
        localSeq: current?.localSeq ?? 0,
        ...(lastError === undefined ? {} : { lastError }),
      };
      await db.meta.put(next);
      return next;
    });

    return { ok: true, meta };
  } catch (error) {
    return { ok: false, reason: classifyJournalError(error) };
  }
}

/* ------------------------------------------------------------- conflicts */

/**
 * Conflicts, as durable rows (F1-5a).
 *
 * The constitution requires the ORIGINAL conflict to stay recorded: what the
 * author was trying to commit, what the server held instead, and which of the
 * two they chose. None of the functions below deletes a conflict row, and
 * resolving one only adds `resolvedVia`/`resolvedAt` to it — the version the
 * author decided against is still in the store afterwards, which is what makes
 * "discard" a decision rather than a deletion.
 *
 * Rows are keyed by `[documentId+detectedAt]`, so a second conflict on the
 * same document is a second row and cannot overwrite the first.
 */

/**
 * The unresolved conflicts for one document, newest last.
 *
 * Reads the whole (small) per-document set and filters in JS rather than
 * through an index: `resolvedVia` is absent on exactly the rows we are looking
 * for, and IndexedDB does not index a missing key.
 */
async function unresolvedFor(
  db: JournalDb,
  documentId: string,
): Promise<ConflictRecord[]> {
  const rows = await db.conflicts.where("documentId").equals(documentId).toArray();
  return rows
    .filter((row) => !isResolvedConflict(row))
    .sort((a, b) => (a.detectedAt < b.detectedAt ? -1 : a.detectedAt > b.detectedAt ? 1 : 0));
}

/**
 * The row an operation should act on: the one the panel actually decided about
 * when `detectedAt` names it, and otherwise the newest unresolved one.
 *
 * Naming the row matters once a document can hold several conflicts: the panel
 * shows one record, and the decision it produces must land on that record and
 * not on whichever was newest by the time the author clicked. A named row that
 * is already resolved is `null` — a decision is recorded once.
 */
async function targetConflict(
  db: JournalDb,
  documentId: string,
  detectedAt: string | null,
): Promise<ConflictRecord | null> {
  if (detectedAt !== null) {
    const row = await db.conflicts.get([documentId, detectedAt]);
    return row && !isResolvedConflict(row) ? row : null;
  }
  const rows = await unresolvedFor(db, documentId);
  return rows.length === 0 ? null : rows[rows.length - 1];
}

/**
 * How many RESOLVED conflicts one document keeps.
 *
 * The constitution requires a conflict to stay recorded rather than be deleted
 * on resolution — which means the store grows by one row, holding two whole
 * documents, every time an author resolves one. On a document that conflicts
 * often (two devices, a flaky connection) that is unbounded growth in the same
 * origin quota the pending queue and the snapshots live in, and the first
 * thing it breaks is saving.
 *
 * So resolved rows are capped, oldest first, and UNRESOLVED rows are never
 * touched by the trim at any count: those are the decisions the author still
 * owes, and dropping one would be exactly the silent last-write-wins the
 * conflict machinery exists to prevent. What the cap drops is history of
 * decisions already made — the 21st-oldest resolved conflict, not a pending
 * question.
 */
export const RESOLVED_CONFLICT_LIMIT = 20;

/**
 * Deletes all but the newest `RESOLVED_CONFLICT_LIMIT` resolved rows of one
 * document. Runs INSIDE the caller's `rw` transaction on `conflicts`, so the
 * store is never observed over its cap and a failed trim rolls back the
 * resolution it accompanies rather than leaving half a prune behind.
 */
async function trimResolvedConflicts(
  db: JournalDb,
  documentId: string,
): Promise<void> {
  const rows = await db.conflicts.where("documentId").equals(documentId).toArray();
  const resolved = rows
    .filter((row) => isResolvedConflict(row))
    .sort((a, b) => (a.detectedAt < b.detectedAt ? -1 : a.detectedAt > b.detectedAt ? 1 : 0));

  if (resolved.length <= RESOLVED_CONFLICT_LIMIT) {
    return;
  }

  const oldest = resolved.slice(0, resolved.length - RESOLVED_CONFLICT_LIMIT);
  await db.conflicts.bulkDelete(
    oldest.map((row) => [row.documentId, row.detectedAt] as [string, string]),
  );
}

/** True when two rows describe the same detection, resolution aside. */
function sameDetection(a: ConflictRecord, b: ConflictRecord): boolean {
  if (
    a.documentId !== b.documentId ||
    a.localBaseRevision !== b.localBaseRevision ||
    a.serverRevision !== b.serverRevision
  ) {
    return false;
  }
  if (!documentsEqual(a.localDocument, b.localDocument)) {
    return false;
  }
  if (a.serverDocument === null || b.serverDocument === null) {
    return a.serverDocument === b.serverDocument;
  }
  return documentsEqual(a.serverDocument, b.serverDocument);
}

/**
 * How many times a detection may be nudged off an occupied key before giving
 * up. Sixty-four conflicts inside one millisecond is not a scenario; it is a
 * bug, and the bound is here so that a bug cannot become an endless loop.
 */
const MAX_DETECTION_NUDGES = 64;

/**
 * Stores a detected conflict, without ever overwriting one already there.
 *
 * Rows are keyed by `[documentId+detectedAt]`, and two conflicts CAN land in
 * the same millisecond (a fast retry, a fake clock, a machine that coalesces
 * timer resolution). A plain `put` would then silently replace the earlier row
 * — losing exactly the original conflict the constitution requires to be kept,
 * and possibly a resolution already recorded on it. So an occupied key is
 * nudged with a `+n` suffix instead: still sorted after its neighbour (the
 * suffix only extends the string), still readable, and it collides with
 * nothing. Re-recording a byte-identical detection stays idempotent, because
 * that is a retry of the same fact rather than a second one.
 *
 * Called BEFORE the state machine is told about the conflict, so a session
 * that dies between the two still has the evidence.
 */
export async function recordConflict(
  db: JournalDb,
  record: ConflictRecord,
): Promise<ConflictResult> {
  try {
    const stored = await db.transaction("rw", db.conflicts, async () => {
      let detectedAt = record.detectedAt;
      for (let n = 1; n <= MAX_DETECTION_NUDGES; n += 1) {
        const existing = await db.conflicts.get([record.documentId, detectedAt]);
        if (!existing) {
          break;
        }
        if (sameDetection(existing, record)) {
          // The same fact, recorded twice. Keep what is stored — including any
          // resolution already written on it.
          return existing;
        }
        detectedAt = `${record.detectedAt}+${n}`;
      }

      const next: ConflictRecord = { ...record, detectedAt };
      await db.conflicts.put(next);
      return next;
    });

    return { ok: true, conflict: stored };
  } catch (error) {
    return { ok: false, reason: classifyJournalError(error) };
  }
}

/**
 * The conflict this document is waiting on, or `null`.
 *
 * The newest unresolved row wins: it is the one whose local document is still
 * in the queue and the one the author is being asked about. Older rows —
 * resolved or not — stay where they are.
 */
export async function loadUnresolvedConflict(
  db: JournalDb,
  documentId: string,
): Promise<ConflictResult> {
  try {
    const rows = await unresolvedFor(db, documentId);
    return { ok: true, conflict: rows.length === 0 ? null : rows[rows.length - 1] };
  } catch (error) {
    return { ok: false, reason: classifyJournalError(error) };
  }
}

/**
 * Records the author's decision on a conflict — the one `detectedAt` names, or
 * the newest unresolved one when it is omitted.
 *
 * The row is UPDATED, never removed: `resolvedVia` and `resolvedAt` are added
 * and everything else — both documents, both revisions — stays exactly as it
 * was. Returns `{ conflict: null }` when there was nothing unresolved to act
 * on, which is not an error: a double click, or a resolution recorded by
 * another path, must not fail the author's action.
 *
 * The same transaction then trims this document's resolved history to
 * `RESOLVED_CONFLICT_LIMIT` (F1-10). Unresolved rows are never trimmed.
 */
export async function markConflictResolved(
  db: JournalDb,
  documentId: string,
  via: ConflictResolution,
  detectedAt: string | null = null,
  nowFn: () => string = defaultNow,
): Promise<ConflictResult> {
  try {
    const resolved = await db.transaction("rw", db.conflicts, async () => {
      const target = await targetConflict(db, documentId, detectedAt);
      if (!target) {
        return null;
      }
      const next: ConflictRecord = { ...target, resolvedVia: via, resolvedAt: nowFn() };
      await db.conflicts.put(next);
      await trimResolvedConflicts(db, documentId);
      return next;
    });

    return { ok: true, conflict: resolved };
  } catch (error) {
    return { ok: false, reason: classifyJournalError(error) };
  }
}

/** Reads the server's version, turning every unhappy answer into `null`. */
async function fetchServerSafely(fetchServer: FetchServerFn): Promise<ServerSide | null> {
  try {
    return await fetchServer();
  } catch {
    // A throwing fetch tells us nothing about the server; it is the same
    // situation as one that answered "no".
    return null;
  }
}

/**
 * Fills in (or refreshes) the server side of the waiting conflict.
 *
 * The server's document is fetched by the caller's function — this module
 * never talks to a server — and the fetch runs OUTSIDE the write transaction,
 * because an IndexedDB transaction that waits on a network round trip is a
 * transaction that will be auto-committed out from under itself.
 *
 * A fetch that comes back empty is not a failure: the row is returned
 * unchanged, still with `serverDocument: null`, and the panel keeps offering
 * the retry rather than pretending it has a version to adopt.
 */
export async function refreshConflictServerSide(
  db: JournalDb,
  documentId: string,
  fetchServer: FetchServerFn,
  detectedAt: string | null = null,
): Promise<ConflictResult> {
  const server = await fetchServerSafely(fetchServer);

  try {
    const updated = await db.transaction("rw", db.conflicts, async () => {
      const target = await targetConflict(db, documentId, detectedAt);
      if (!target || !server) {
        return target;
      }
      const next: ConflictRecord = {
        ...target,
        serverDocument: server.document,
        serverRevision: server.revision,
      };
      await db.conflicts.put(next);
      return next;
    });

    return { ok: true, conflict: updated };
  } catch (error) {
    return { ok: false, reason: classifyJournalError(error) };
  }
}

/**
 * Rebuilds a conflict record for a document that is in CONFLICT with nothing
 * recorded — the recovery path for the one moment the F1-5a flow can lose its
 * evidence: `recordConflict` failed (a full or unavailable store) while the
 * state machine went to CONFLICT anyway, or the tab died between the two.
 *
 * Everything needed is still in the journal, because a conflict halts the
 * drain and freezes the journal: the newest pending row is exactly the
 * transaction the server refused, with the base that turned out to be stale.
 * (A journal with no queue left falls back to the snapshot — the author would
 * then be choosing between their current text and the server's, which is still
 * the honest question.) The server's side comes from a fresh read.
 *
 * Returns `{ conflict: null }` rather than a half-record when the server
 * cannot be read: without the server's revision there is no conflict to
 * describe, only a suspicion, and the UI keeps offering the retry.
 */
export async function recoverConflict(
  db: JournalDb,
  documentId: string,
  fetchServer: FetchServerFn,
  nowFn: () => string = defaultNow,
): Promise<ConflictResult> {
  const loaded = await loadJournal(db, documentId);
  if (!loaded.ok) {
    return { ok: false, reason: loaded.reason };
  }

  const newest = loaded.contents.pending.reduce<PendingTransaction | null>(
    (best, row) => (best === null || row.localSeq > best.localSeq ? row : best),
    null,
  );

  const localDocument = newest?.tx.document ?? loaded.contents.snapshot?.document ?? null;
  const localBaseRevision =
    newest?.tx.baseRevision ?? loaded.contents.snapshot?.revision ?? null;
  if (!localDocument || localBaseRevision === null) {
    return { ok: true, conflict: null };
  }

  const server = await fetchServerSafely(fetchServer);
  if (!server) {
    return { ok: true, conflict: null };
  }

  return recordConflict(
    db,
    buildConflictRecord(
      {
        documentId,
        localDocument,
        localBaseRevision,
        serverDocument: server.document,
        serverRevision: server.revision,
      },
      nowFn,
    ),
  );
}

/**
 * Adopts the server's document as the local one — the journal half of an
 * explicit DISCARD (F1-5a).
 *
 * All three writes happen in ONE transaction, for the same reason `saveLocal`
 * does (dossier §7):
 *   1. the snapshot becomes the server's document at the server's revision,
 *   2. every pending row for the document is dropped — the queue is exactly
 *      what the author just decided not to send,
 *   3. meta records SYNCED, which is honest only because 2. emptied the queue.
 *
 * Doing 2. and 3. without 1. (`clearPending` + `markSynced`) would leave the
 * DISCARDED local document sitting in the snapshot, stamped with the server's
 * revision. The next visit resolves its initial document from the snapshot
 * first (`resolveInitialDocument`), so the author's discarded text would come
 * back — as SYNCED, claiming the server holds it. That is the silent
 * last-write-wins the constitution forbids, arriving one reload later.
 *
 * The conflict row itself is untouched: the discarded document is preserved
 * there, and `markConflictResolved` is what records the decision.
 */
export async function adoptServerDocument(
  db: JournalDb,
  documentId: string,
  document: CanonicalDocument,
  revision: number,
  nowFn: () => string = defaultNow,
): Promise<AdoptServerDocumentResult> {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    // Same rule as `markSynced`: a revision that cannot be compared against on
    // the next CAS is refused rather than stored.
    return { ok: false, reason: "unknown" };
  }

  try {
    const applied = await db.transaction(
      "rw",
      db.snapshots,
      db.pending,
      db.meta,
      async () => {
        await db.snapshots.put({
          documentId,
          revision,
          document,
          savedAt: nowFn(),
        });

        const keys = await db.pending.where("documentId").equals(documentId).primaryKeys();
        await db.pending.bulkDelete(keys);

        const current = await db.meta.get(documentId);
        const next: SyncMeta = {
          documentId,
          // The queue was just emptied inside this same transaction, so the
          // server really does hold everything this document owes.
          state: "SYNCED" satisfies SyncState,
          localSeq: current?.localSeq ?? 0,
        };
        await db.meta.put(next);

        return { meta: next, cleared: keys.length };
      },
    );

    return { ok: true, meta: applied.meta, cleared: applied.cleared, revision };
  } catch (error) {
    return { ok: false, reason: classifyJournalError(error) };
  }
}
