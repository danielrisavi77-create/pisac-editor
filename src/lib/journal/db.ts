/**
 * The local durable journal's storage engine: Dexie over IndexedDB (F1-3a).
 *
 * Nothing here runs at import time. A module-level `new Dexie(...)` would
 * throw in any environment without IndexedDB (server render, a browser with
 * site data blocked, a private window in some engines) and take the whole
 * editor page down with it. Opening is therefore explicit and guarded:
 * `openJournal()` returns a typed failure instead of throwing, so the sync
 * state machine can show RECOVERY_REQUIRED rather than a blank screen.
 */

import Dexie, { type Table } from "dexie";

import type { ConflictRecord } from "@/domain/sync/conflict";
import type {
  JournalSnapshot,
  PendingTransaction,
  SyncMeta,
} from "@/domain/sync/journal-types";
import type { LocalSaveFailureReason } from "@/domain/sync/states";

export const JOURNAL_DB_NAME = "pisac-journal";
export const JOURNAL_DB_VERSION = 2;

/**
 * Schema v1.
 *
 * - `snapshots`  pk `documentId`            — newest candidate per document.
 * - `pending`    pk `[documentId+localSeq]` — the queue owed to the server,
 *                plus a `documentId` index so one document's queue can be
 *                read and cleared without scanning the others.
 * - `meta`       pk `documentId`            — sync state + local sequence.
 *
 * All three are written in one transaction by `saveLocal` (dossier §7).
 *
 * Schema v2 (F1-5a) is purely additive — it adds `conflicts` and touches
 * nothing else, so Dexie carries the three v1 stores over untouched and an
 * existing journal upgrades without a data migration.
 *
 * - `conflicts`  pk `[documentId+detectedAt]` — one row per detected conflict,
 *                plus a `documentId` index. The key is the *detection*, not
 *                the document, precisely so a resolved conflict is never
 *                overwritten by the next one: the constitution requires the
 *                original conflict to stay recorded, and a row keyed by
 *                document alone would quietly replace history.
 *
 *                `resolvedVia` is deliberately NOT indexed. It is absent on an
 *                unresolved row, and IndexedDB leaves records with a missing
 *                key out of an index entirely — so the one query that matters
 *                ("is there an unresolved conflict?") could not use it.
 */
export class JournalDatabase extends Dexie {
  snapshots!: Table<JournalSnapshot, string>;
  pending!: Table<PendingTransaction, [string, number]>;
  meta!: Table<SyncMeta, string>;
  conflicts!: Table<ConflictRecord, [string, string]>;

  constructor(name: string = JOURNAL_DB_NAME) {
    super(name);
    this.version(1).stores({
      snapshots: "documentId",
      pending: "[documentId+localSeq], documentId",
      meta: "documentId",
    });
    this.version(2).stores({
      conflicts: "[documentId+detectedAt], documentId",
    });
  }
}

/**
 * The subset of `JournalDatabase` the journal functions actually use. Taking
 * this rather than the concrete class keeps `journal.ts` testable with a
 * hand-written failing stub (for the quota path) without a real IndexedDB.
 */
export type JournalDb = Pick<
  JournalDatabase,
  "snapshots" | "pending" | "meta" | "conflicts" | "transaction"
>;

export type JournalOpenResult =
  | { ok: true; db: JournalDatabase }
  | { ok: false; reason: LocalSaveFailureReason };

/** True when this environment exposes a usable IndexedDB global. */
export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    // Accessing the global can itself throw where site data is blocked.
    return false;
  }
}

/**
 * Error name → reducer failure reason.
 *
 * 'corrupt' and 'unavailable' are the two reasons that escalate to
 * RECOVERY_REQUIRED, so the mapping is deliberately conservative: a name we do
 * not recognise is 'unknown' (an ordinary, retryable ERROR), never a claim
 * that the author's local store is broken.
 */
const REASON_BY_ERROR_NAME: Readonly<Record<string, LocalSaveFailureReason>> = {
  // Out of space — retryable once something is freed.
  QuotaExceededError: "quota",
  // The store cannot be reached at all.
  InvalidStateError: "unavailable",
  MissingAPIError: "unavailable",
  DatabaseClosedError: "unavailable",
  // The store is there but is not what it should be.
  DataError: "corrupt",
  NotFoundError: "corrupt",
  VersionError: "corrupt",
  UpgradeError: "corrupt",
  InvalidTableError: "corrupt",
};

type ErrorLink = { name?: unknown; inner?: unknown; cause?: unknown };

/**
 * Classifies a Dexie/IndexedDB error into a `LOCAL_SAVE_FAILED` reason.
 *
 * Dexie wraps the underlying DOMException, so the original name can sit one
 * or two links down (`inner`, `cause`); the chain is walked with a hard depth
 * bound because a cyclic `cause` must not hang a save path.
 */
export function classifyJournalError(error: unknown): LocalSaveFailureReason {
  let current: unknown = error;

  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth += 1) {
    const link = current as ErrorLink;
    const name = typeof link.name === "string" ? link.name : null;
    if (name !== null) {
      const reason = REASON_BY_ERROR_NAME[name];
      if (reason) {
        return reason;
      }
    }
    current = link.inner ?? link.cause ?? null;
  }

  return "unknown";
}

/**
 * Opens the journal, or reports why it cannot be opened. Never throws.
 *
 * `name` is injectable so each test gets its own database and the suite stays
 * order-independent.
 */
export async function openJournal(
  name: string = JOURNAL_DB_NAME,
): Promise<JournalOpenResult> {
  if (!indexedDbAvailable()) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const db = new JournalDatabase(name);
    await db.open();
    return { ok: true, db };
  } catch (error) {
    return { ok: false, reason: classifyJournalError(error) };
  }
}
