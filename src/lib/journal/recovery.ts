/**
 * The recovery flow's storage half (F1-5b): reading what is left of a damaged
 * journal, and applying the choice the author made about it.
 *
 * `src/domain/sync/recovery.ts` decides what CAN be offered; this file does
 * the two things a pure function cannot — it touches IndexedDB, and it talks
 * to the caller's server reader.
 *
 * Two rules shape every line below.
 *
 *   1. Never silent. RECOVERY_REQUIRED is one of the two sticky states, and it
 *      is left only by `RECOVERED`, which is dispatched by the caller AFTER
 *      `executeRecovery` reports that the write landed. Nothing here recovers
 *      anything on its own, nothing picks a version, and `resetJournalDatabase`
 *      — which destroys the store outright — runs only on the branch the
 *      author explicitly chose.
 *   2. Never optimistic about a broken store. Each read is individually
 *      try/caught, because the whole premise is a store that fails
 *      unpredictably: a `snapshots.get` that throws must not stop us from
 *      finding a perfectly good pending row, and a store where nothing could
 *      be read is reported as unreadable rather than as empty.
 */

import { validateDocument, type CanonicalDocument, type DocumentTransaction } from "@/domain/document";
import {
  planRecovery,
  type LocalCandidateInput,
  type RecoveryChoice,
  type RecoveryPlan,
} from "@/domain/sync";
import type { JournalSnapshot, PendingTransaction } from "@/domain/sync/journal-types";
import type { LocalSaveFailureReason } from "@/domain/sync/states";

import {
  JOURNAL_DB_NAME,
  resetJournalDatabase,
  type JournalDb,
} from "./db";
import {
  JOURNAL_FROZEN,
  adoptServerDocument,
  rebaseLocal,
  type FetchServerFn,
  type ServerSide,
} from "./journal";

export type JournalRecoveryReport = {
  /** What the author may be offered, and which option is suggested. */
  plan: RecoveryPlan;
  /**
   * False when the store could not be fully read and must therefore be
   * assumed unusable for WRITING as well. `executeRecovery` is then called
   * with a `null` database and recreates it — destructively, and only because
   * the author picked a branch that needs somewhere to write.
   */
  journalUsable: boolean;
};

/**
 * Why a recovery could not be carried out.
 *
 * 'unavailable-choice' — the branch the caller asked for is not one the plan
 *                        offers (a stale panel, a double click).
 * 'server-unreadable'  — an adoption was asked for and the fresh read of the
 *                        server did not come back. Deliberately not a fallback
 *                        to the document the plan was built with: adopting a
 *                        revision the server has since moved past would lose
 *                        the newer text and claim SYNCED at a revision that is
 *                        no longer current.
 * anything else        — the journal refused the write, with its own reason.
 */
export type RecoveryFailureReason =
  | LocalSaveFailureReason
  | "unavailable-choice"
  | "server-unreadable";

export type RecoveryExecution =
  | {
      ok: true;
      choice: RecoveryChoice;
      /** What the editor must now show. */
      document: CanonicalDocument;
      /** The base every later commit is written against. */
      baseRevision: number;
      /** True when the local database had to be deleted and recreated. */
      databaseReset: boolean;
      /** The journal handle to use from now on — a fresh one after a reset. */
      db: JournalDb;
    }
  | { ok: false; reason: RecoveryFailureReason };

/** One read of a damaged store: the value, or the fact that it threw. */
type Attempt<T> = { ok: true; value: T } | { ok: false };

async function attempt<T>(read: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return { ok: false };
  }
}

/** The newest queued transaction, by local sequence. */
function newestPending(rows: readonly PendingTransaction[]): PendingTransaction | null {
  return rows.reduce<PendingTransaction | null>(
    (best, row) => (best === null || row.localSeq > best.localSeq ? row : best),
    null,
  );
}

/**
 * A stored row as plan input. Every field is treated as untrusted: this is a
 * store that is being recovered precisely because its bytes stopped being
 * reliable, and a row whose `tx` is missing must degrade to "not salvageable"
 * rather than throw on the way to the panel.
 */
function pendingInput(row: PendingTransaction | null): LocalCandidateInput {
  if (!row) {
    return null;
  }
  const tx = row.tx as Partial<DocumentTransaction> | undefined;
  return {
    document: tx?.document ?? null,
    revision: tx?.baseRevision ?? null,
    at: typeof row.queuedAt === "string" ? row.queuedAt : null,
  };
}

function snapshotInput(row: JournalSnapshot | null): LocalCandidateInput {
  if (!row) {
    return null;
  }
  return {
    document: row.document ?? null,
    revision: row.revision ?? null,
    at: typeof row.savedAt === "string" ? row.savedAt : null,
  };
}

/** Reads the server's version, turning every unhappy answer into `null`. */
async function fetchServerSafely(fetchServer: FetchServerFn): Promise<ServerSide | null> {
  try {
    return await fetchServer();
  } catch {
    return null;
  }
}

/**
 * Reads whatever the journal will still give up for one document, asks the
 * server for its version, and plans the way out.
 *
 * The two local reads are separate and separately guarded, and neither uses a
 * Dexie transaction: a `readonly` transaction over a damaged store fails as a
 * whole, which is exactly the all-or-nothing behaviour recovery must avoid.
 * Consistency between the two rows does not matter here — they are two
 * candidates the author chooses between, not one state being restored.
 *
 * `db` is `null` when the store could not even be opened. The plan then offers
 * the server's document only, and says why.
 */
export async function attemptJournalRecovery(
  db: JournalDb | null,
  documentId: string,
  fetchServer: FetchServerFn,
): Promise<JournalRecoveryReport> {
  const snapshot = db
    ? await attempt(async () => (await db.snapshots.get(documentId)) ?? null)
    : ({ ok: false } as Attempt<JournalSnapshot | null>);

  const pending = db
    ? await attempt(async () =>
        newestPending(await db.pending.where("documentId").equals(documentId).toArray()),
      )
    : ({ ok: false } as Attempt<PendingTransaction | null>);

  const server = await fetchServerSafely(fetchServer);

  const plan = planRecovery({
    // At least one read came back: whatever it found is something we really
    // did see. A store where BOTH reads threw is reported as unreadable, so
    // the panel never tells the author their work is simply "not there".
    journalReadable: snapshot.ok || pending.ok,
    snapshot: snapshot.ok ? snapshotInput(snapshot.value) : null,
    pendingNewest: pending.ok ? pendingInput(pending.value) : null,
    serverDocument: server?.document ?? null,
    serverRevision: server?.revision ?? null,
  });

  return { plan, journalUsable: db !== null && snapshot.ok && pending.ok };
}

/** The handle to write through, recreating the database when there is none. */
async function writableJournal(
  db: JournalDb | null,
  databaseName: string,
): Promise<{ ok: true; db: JournalDb; reset: boolean } | { ok: false; reason: LocalSaveFailureReason }> {
  if (db) {
    return { ok: true, db, reset: false };
  }
  // The author asked for this: the store cannot be written to, so it is
  // deleted and recreated. See the warning on `resetJournalDatabase`.
  const reopened = await resetJournalDatabase(databaseName);
  if (!reopened.ok) {
    return { ok: false, reason: reopened.reason };
  }
  return { ok: true, db: reopened.db, reset: true };
}

/**
 * Carries out the choice the author made.
 *
 *   salvage-local — write the salvaged document back as a fresh, atomic
 *                   journal entry (`rebaseLocal`, the one write allowed while
 *                   the journal is frozen, because it IS the decision), queued
 *                   against the base revision it carried. It still has to pass
 *                   the server's compare-and-set, so a server that moved on
 *                   raises an honest conflict rather than an overwrite.
 *   adopt-server  — re-read the server, then adopt its document in ONE journal
 *                   transaction (`adoptServerDocument`: snapshot, empty queue
 *                   and SYNCED together). The re-read is not optional; see
 *                   'server-unreadable' above.
 *
 * `db` is `null` when the store is unusable, and only then is it recreated.
 * The caller dispatches `RECOVERED` with the same choice after this returns
 * `ok` — never before, because a decision that was not written down has not
 * been made.
 */
export async function executeRecovery(
  db: JournalDb | null,
  documentId: string,
  choice: RecoveryChoice,
  plan: RecoveryPlan,
  fetchServer: FetchServerFn,
  databaseName: string = JOURNAL_DB_NAME,
): Promise<RecoveryExecution> {
  if (choice === "salvage-local") {
    if (!plan.canSalvageLocal || plan.salvage === null) {
      return { ok: false, reason: "unavailable-choice" };
    }

    const target = await writableJournal(db, databaseName);
    if (!target.ok) {
      return { ok: false, reason: target.reason };
    }

    const written = await rebaseLocal(
      target.db,
      documentId,
      plan.salvage.document,
      plan.salvage.revision,
    );
    if (!written.ok) {
      // `rebaseLocal` is allowed to write while frozen, so the freeze marker
      // cannot come back here; it is mapped rather than trusted not to.
      return {
        ok: false,
        reason: written.reason === JOURNAL_FROZEN ? "unknown" : written.reason,
      };
    }

    return {
      ok: true,
      choice,
      document: plan.salvage.document,
      baseRevision: plan.salvage.revision,
      databaseReset: target.reset,
      db: target.db,
    };
  }

  if (choice !== "adopt-server") {
    return { ok: false, reason: "unavailable-choice" };
  }
  if (!plan.canAdoptServer) {
    return { ok: false, reason: "unavailable-choice" };
  }

  const fresh = await fetchServerSafely(fetchServer);
  if (!fresh) {
    return { ok: false, reason: "server-unreadable" };
  }
  const validated = validateDocument(fresh.document);
  if (!validated.ok) {
    return { ok: false, reason: "server-unreadable" };
  }

  const target = await writableJournal(db, databaseName);
  if (!target.ok) {
    return { ok: false, reason: target.reason };
  }

  const adopted = await adoptServerDocument(
    target.db,
    documentId,
    validated.doc,
    fresh.revision,
  );
  if (!adopted.ok) {
    return { ok: false, reason: adopted.reason };
  }

  return {
    ok: true,
    choice,
    document: validated.doc,
    baseRevision: adopted.revision,
    databaseReset: target.reset,
    db: target.db,
  };
}
