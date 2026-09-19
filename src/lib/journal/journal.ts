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
