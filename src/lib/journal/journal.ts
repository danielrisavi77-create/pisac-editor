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
 */

import type { CanonicalDocument } from "@/domain/document";
import type { DocumentTransaction } from "@/domain/document";
import type {
  JournalContents,
  PendingTransaction,
  SyncMeta,
} from "@/domain/sync/journal-types";
import type { LocalSaveFailureReason, SyncState } from "@/domain/sync/states";

import { classifyJournalError, type JournalDb } from "./db";

export type SaveLocalResult =
  | { ok: true; localSeq: number }
  | { ok: false; reason: LocalSaveFailureReason };

export type LoadJournalResult =
  | { ok: true; contents: JournalContents }
  | { ok: false; reason: LocalSaveFailureReason };

export type ClearPendingResult =
  | { ok: true; cleared: number }
  | { ok: false; reason: LocalSaveFailureReason };

export type MarkStateResult =
  | { ok: true; meta: SyncMeta }
  | { ok: false; reason: LocalSaveFailureReason };

function defaultUuid(): string {
  return crypto.randomUUID();
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Writes one canonical candidate to the journal, atomically.
 *
 * Builds the F1 transaction (`REPLACE_DOCUMENT`, a fresh client transaction id
 * for the `(document, actor, clientTransactionId)` idempotency key) and then,
 * inside a single `rw` transaction:
 *   1. replaces the snapshot,
 *   2. appends a pending row at `meta.localSeq + 1`,
 *   3. updates meta (local sequence + sync state).
 *
 * The recorded state is LOCAL_DURABLE, never SYNCED: this function has not
 * spoken to a server and must not imply that it has.
 *
 * `uuidFn` and `nowFn` are injectable so tests and replay tooling stay
 * deterministic; `nowFn` is the small deviation from a pure domain call — the
 * journal is the layer that is allowed to read a clock.
 *
 * Failures are mapped to the reducer's `LOCAL_SAVE_FAILED` reasons rather than
 * thrown, so the caller's next dispatch is a plain state transition.
 */
export async function saveLocal(
  db: JournalDb,
  documentId: string,
  candidate: CanonicalDocument,
  baseRevision: number,
  uuidFn: () => string = defaultUuid,
  nowFn: () => string = defaultNow,
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

        return nextSeq;
      },
    );

    return { ok: true, localSeq };
  } catch (error) {
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
