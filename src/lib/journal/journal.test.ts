// @vitest-environment node
import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  emptyDocument,
  paragraphNode,
  textNode,
  type CanonicalDocument,
} from "@/domain/document";

import {
  JournalDatabase,
  classifyJournalError,
  indexedDbAvailable,
  openJournal,
  type JournalDb,
} from "./db";
import {
  PENDING_LIMIT,
  adoptServerDocument,
  clearPending,
  loadJournal,
  loadUnresolvedConflict,
  markConflictResolved,
  markState,
  markSynced,
  recordConflict,
  refreshConflictServerSide,
  saveLocal,
} from "./journal";
import { buildConflictRecord, restoreSyncState } from "@/domain/sync";

const DOC_A = "11111111-1111-4111-8111-111111111111";
const DOC_B = "22222222-2222-4222-8222-222222222222";

/** Deterministic UUID generator: ids stay stable so assertions can name them. */
function uuidSeq(prefix = "a"): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

function clockSeq(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `2026-09-19T10:00:${String(n).padStart(2, "0")}.000Z`;
  };
}

function docWithText(text: string, uuidFn: () => string): CanonicalDocument {
  const empty = emptyDocument(uuidFn);
  return {
    ...empty,
    nodes: [paragraphNode(empty.nodes[0].id, [textNode(text)])],
  };
}

/** A db whose every transaction rejects — for the error-mapping paths. */
function failingDb(db: JournalDatabase, error: unknown): JournalDb {
  return {
    snapshots: db.snapshots,
    pending: db.pending,
    meta: db.meta,
    conflicts: db.conflicts,
    transaction: (() =>
      Promise.reject(error)) as unknown as JournalDatabase["transaction"],
  };
}

function domError(name: string): Error {
  const error = new Error(`simulated ${name}`);
  error.name = name;
  return error;
}

let db: JournalDatabase;
let dbCounter = 0;

beforeEach(async () => {
  dbCounter += 1;
  db = new JournalDatabase(`pisac-journal-test-${dbCounter}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("openJournal", () => {
  it("opens the journal when IndexedDB is available", async () => {
    expect(indexedDbAvailable()).toBe(true);
    const opened = await openJournal(`pisac-journal-open-${dbCounter}`);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.db.name).toBe(`pisac-journal-open-${dbCounter}`);
      await opened.db.delete();
    }
  });

  it("reports 'unavailable' instead of throwing when IndexedDB is missing", async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error — deleting the global is the situation under test.
    delete globalThis.indexedDB;
    try {
      expect(indexedDbAvailable()).toBe(false);
      const opened = await openJournal("pisac-journal-missing");
      expect(opened).toEqual({ ok: false, reason: "unavailable" });
    } finally {
      globalThis.indexedDB = real;
    }
  });
});

describe("classifyJournalError", () => {
  it.each([
    ["QuotaExceededError", "quota"],
    ["InvalidStateError", "unavailable"],
    ["MissingAPIError", "unavailable"],
    ["DatabaseClosedError", "unavailable"],
    ["DataError", "corrupt"],
    ["NotFoundError", "corrupt"],
    ["VersionError", "corrupt"],
    ["UpgradeError", "corrupt"],
  ] as const)("maps %s to %s", (name, reason) => {
    expect(classifyJournalError(domError(name))).toBe(reason);
  });

  it("looks inside Dexie's wrapper (`inner`)", () => {
    const wrapper = domError("DexieError") as Error & { inner?: unknown };
    wrapper.inner = domError("QuotaExceededError");
    expect(classifyJournalError(wrapper)).toBe("quota");
  });

  it("follows a `cause` chain", () => {
    const wrapper = new Error("outer", { cause: domError("DataError") });
    expect(classifyJournalError(wrapper)).toBe("corrupt");
  });

  it("does not guess 'corrupt' for an unrecognised error", () => {
    expect(classifyJournalError(domError("TypeError"))).toBe("unknown");
    expect(classifyJournalError("a string")).toBe("unknown");
    expect(classifyJournalError(null)).toBe("unknown");
    expect(classifyJournalError(undefined)).toBe("unknown");
  });

  it("terminates on a cyclic cause chain", () => {
    const a = domError("WeirdError") as Error & { cause?: unknown };
    const b = domError("AlsoWeirdError") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(classifyJournalError(a)).toBe("unknown");
  });
});

describe("saveLocal", () => {
  it("assigns localSeq 1 to the first write of a document", async () => {
    const result = await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    expect(result).toEqual({ ok: true, localSeq: 1 });
  });

  it("increments the local sequence on every write", async () => {
    const uuid = uuidSeq("b");
    const doc = emptyDocument(uuidSeq());
    const seqs: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = await saveLocal(db, DOC_A, doc, 0, uuid);
      if (result.ok) {
        seqs.push(result.localSeq);
      }
    }
    expect(seqs).toEqual([1, 2, 3, 4]);
  });

  it("keeps sequences independent per document", async () => {
    const doc = emptyDocument(uuidSeq());
    await saveLocal(db, DOC_A, doc, 0, uuidSeq("b"));
    await saveLocal(db, DOC_A, doc, 0, uuidSeq("c"));
    const other = await saveLocal(db, DOC_B, doc, 0, uuidSeq("d"));
    expect(other).toEqual({ ok: true, localSeq: 1 });
  });

  it("writes snapshot, pending row and meta together", async () => {
    const doc = docWithText("Uvod", uuidSeq());
    await saveLocal(db, DOC_A, doc, 7, uuidSeq("b"), clockSeq());

    const snapshot = await db.snapshots.get(DOC_A);
    const pending = await db.pending.where("documentId").equals(DOC_A).toArray();
    const meta = await db.meta.get(DOC_A);

    expect(snapshot).toEqual({
      documentId: DOC_A,
      revision: 7,
      document: doc,
      savedAt: "2026-09-19T10:00:01.000Z",
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toEqual({
      documentId: DOC_A,
      localSeq: 1,
      queuedAt: "2026-09-19T10:00:01.000Z",
      tx: {
        kind: "REPLACE_DOCUMENT",
        clientTransactionId: "bbbbbbbb-0000-4000-8000-000000000001",
        baseRevision: 7,
        document: doc,
        createdAt: "2026-09-19T10:00:01.000Z",
      },
    });
    expect(meta).toEqual({ documentId: DOC_A, localSeq: 1, state: "LOCAL_DURABLE" });
  });

  it("records LOCAL_DURABLE, never SYNCED — nothing reached a server", async () => {
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    const meta = await db.meta.get(DOC_A);
    expect(meta?.state).toBe("LOCAL_DURABLE");
  });

  it("stores the base revision, not an invented server revision", async () => {
    const doc = emptyDocument(uuidSeq());
    await saveLocal(db, DOC_A, doc, 3, uuidSeq("b"));
    await saveLocal(db, DOC_A, doc, 3, uuidSeq("c"));
    const snapshot = await db.snapshots.get(DOC_A);
    expect(snapshot?.revision).toBe(3);
  });

  it("replaces the snapshot but appends to the queue", async () => {
    const uuid = uuidSeq();
    await saveLocal(db, DOC_A, docWithText("prva", uuid), 0, uuidSeq("b"));
    await saveLocal(db, DOC_A, docWithText("druga", uuid), 0, uuidSeq("c"));

    const snapshot = await db.snapshots.get(DOC_A);
    const pending = await db.pending.where("documentId").equals(DOC_A).toArray();

    expect(snapshot?.document.nodes[0].children[0]?.text).toBe("druga");
    expect(pending).toHaveLength(2);
    expect(await db.snapshots.count()).toBe(1);
  });

  it("mints a fresh client transaction id per write (idempotency key)", async () => {
    const doc = emptyDocument(uuidSeq());
    const uuid = uuidSeq("b");
    await saveLocal(db, DOC_A, doc, 0, uuid);
    await saveLocal(db, DOC_A, doc, 0, uuid);
    const ids = (await db.pending.where("documentId").equals(DOC_A).sortBy("localSeq"))
      .map((row) => row.tx.clientTransactionId);
    expect(new Set(ids).size).toBe(2);
  });

  it("builds a REPLACE_DOCUMENT transaction — the only F1 mutation", async () => {
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    const row = await db.pending.get([DOC_A, 1]);
    expect(row?.tx.kind).toBe("REPLACE_DOCUMENT");
  });

  it("clears a stale lastError once a write succeeds", async () => {
    await markState(db, DOC_A, "ERROR", "quota");
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    const meta = await db.meta.get(DOC_A);
    expect(meta?.lastError).toBeUndefined();
  });

  it.each([
    ["QuotaExceededError", "quota"],
    ["InvalidStateError", "unavailable"],
    ["DataError", "corrupt"],
    ["SomethingElseError", "unknown"],
  ] as const)("maps a %s during the write to '%s'", async (name, reason) => {
    const broken = failingDb(db, domError(name));
    const result = await saveLocal(broken, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    expect(result).toEqual({ ok: false, reason });
  });

  it("writes nothing at all when the transaction fails", async () => {
    const broken = failingDb(db, domError("QuotaExceededError"));
    await saveLocal(broken, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    expect(await db.snapshots.count()).toBe(0);
    expect(await db.pending.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
  });

  it("caps the pending queue at the newest PENDING_LIMIT rows", async () => {
    const doc = emptyDocument(uuidSeq());
    const uuid = uuidSeq("b");
    const overflow = 5;
    for (let i = 0; i < PENDING_LIMIT + overflow; i += 1) {
      await saveLocal(db, DOC_A, doc, 0, uuid);
    }

    const rows = await db.pending.where("documentId").equals(DOC_A).sortBy("localSeq");
    expect(rows).toHaveLength(PENDING_LIMIT);
    // The oldest rows go; the newest — the ones closest to what the author
    // sees — stay.
    expect(rows[0].localSeq).toBe(overflow + 1);
    expect(rows[rows.length - 1].localSeq).toBe(PENDING_LIMIT + overflow);
  });

  it("keeps the local sequence advancing past the cap", async () => {
    const doc = emptyDocument(uuidSeq());
    const uuid = uuidSeq("b");
    for (let i = 0; i < PENDING_LIMIT + 2; i += 1) {
      await saveLocal(db, DOC_A, doc, 0, uuid);
    }
    const meta = await db.meta.get(DOC_A);
    expect(meta?.localSeq).toBe(PENDING_LIMIT + 2);
  });

  it("trims only the document being written", async () => {
    const doc = emptyDocument(uuidSeq());
    await saveLocal(db, DOC_B, doc, 0, uuidSeq("c"));
    const uuid = uuidSeq("b");
    for (let i = 0; i < PENDING_LIMIT + 3; i += 1) {
      await saveLocal(db, DOC_A, doc, 0, uuid);
    }
    expect(await db.pending.where("documentId").equals(DOC_B).count()).toBe(1);
  });

  it("leaves a queue under the cap alone", async () => {
    const doc = emptyDocument(uuidSeq());
    const uuid = uuidSeq("b");
    for (let i = 0; i < 4; i += 1) {
      await saveLocal(db, DOC_A, doc, 0, uuid);
    }
    expect(await db.pending.where("documentId").equals(DOC_A).count()).toBe(4);
  });

  it("leaves the previous durable state intact when a later write aborts", async () => {
    const uuid = uuidSeq();
    await saveLocal(db, DOC_A, docWithText("sigurna", uuid), 0, uuidSeq("b"));

    // A value IndexedDB cannot structurally clone aborts the whole scope.
    const poisoned = {
      ...emptyDocument(uuid),
      nodes: [{ type: "paragraph", id: "x", children: [], boom: () => 1 }],
    } as unknown as CanonicalDocument;
    const result = await saveLocal(db, DOC_A, poisoned, 0, uuidSeq("c"));

    expect(result.ok).toBe(false);
    const snapshot = await db.snapshots.get(DOC_A);
    const meta = await db.meta.get(DOC_A);
    expect(snapshot?.document.nodes[0].children[0]?.text).toBe("sigurna");
    expect(await db.pending.where("documentId").equals(DOC_A).count()).toBe(1);
    expect(meta?.localSeq).toBe(1);
  });
});

describe("loadJournal", () => {
  it("returns empty contents for a document that was never saved", async () => {
    const loaded = await loadJournal(db, DOC_A);
    expect(loaded).toEqual({
      ok: true,
      contents: { snapshot: null, pending: [], meta: null },
    });
  });

  it("round-trips the snapshot, the queue and meta", async () => {
    const uuid = uuidSeq();
    const first = docWithText("prva", uuid);
    const second = docWithText("druga", uuid);
    await saveLocal(db, DOC_A, first, 2, uuidSeq("b"), clockSeq());
    await saveLocal(db, DOC_A, second, 2, uuidSeq("c"), clockSeq());

    const loaded = await loadJournal(db, DOC_A);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.contents.snapshot?.document).toEqual(second);
    expect(loaded.contents.snapshot?.revision).toBe(2);
    expect(loaded.contents.pending.map((row) => row.localSeq)).toEqual([1, 2]);
    expect(loaded.contents.pending[0].tx.document).toEqual(first);
    expect(loaded.contents.meta).toEqual({
      documentId: DOC_A,
      localSeq: 2,
      state: "LOCAL_DURABLE",
    });
  });

  it("returns the queue ascending by local sequence", async () => {
    const doc = emptyDocument(uuidSeq());
    for (let i = 0; i < 5; i += 1) {
      await saveLocal(db, DOC_A, doc, 0, uuidSeq("b"));
    }
    const loaded = await loadJournal(db, DOC_A);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(loaded.contents.pending.map((row) => row.localSeq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never leaks another document's rows", async () => {
    const doc = emptyDocument(uuidSeq());
    await saveLocal(db, DOC_A, doc, 0, uuidSeq("b"));
    await saveLocal(db, DOC_B, doc, 0, uuidSeq("c"));

    const loaded = await loadJournal(db, DOC_B);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(loaded.contents.pending).toHaveLength(1);
    expect(loaded.contents.pending[0].documentId).toBe(DOC_B);
  });

  it("maps a read failure to a typed reason", async () => {
    const broken = failingDb(db, domError("DatabaseClosedError"));
    expect(await loadJournal(broken, DOC_A)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("clearPending", () => {
  beforeEach(async () => {
    const doc = emptyDocument(uuidSeq());
    for (let i = 0; i < 3; i += 1) {
      await saveLocal(db, DOC_A, doc, 0, uuidSeq("b"));
    }
  });

  it("drops the acknowledged prefix only", async () => {
    expect(await clearPending(db, DOC_A, 2)).toEqual({ ok: true, cleared: 2 });
    const left = await db.pending.where("documentId").equals(DOC_A).sortBy("localSeq");
    expect(left.map((row) => row.localSeq)).toEqual([3]);
  });

  it("is a no-op when nothing is acknowledged yet", async () => {
    expect(await clearPending(db, DOC_A, 0)).toEqual({ ok: true, cleared: 0 });
    expect(await db.pending.where("documentId").equals(DOC_A).count()).toBe(3);
  });

  it("is idempotent for a repeated ACK", async () => {
    await clearPending(db, DOC_A, 2);
    expect(await clearPending(db, DOC_A, 2)).toEqual({ ok: true, cleared: 0 });
  });

  it("keeps the local sequence as a high-water mark", async () => {
    await clearPending(db, DOC_A, 3);
    const meta = await db.meta.get(DOC_A);
    expect(meta?.localSeq).toBe(3);

    const next = await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("c"));
    expect(next).toEqual({ ok: true, localSeq: 4 });
  });

  it("never touches another document's queue", async () => {
    await saveLocal(db, DOC_B, emptyDocument(uuidSeq()), 0, uuidSeq("c"));
    await clearPending(db, DOC_A, 99);
    expect(await db.pending.where("documentId").equals(DOC_B).count()).toBe(1);
  });

  it("leaves the snapshot in place", async () => {
    await clearPending(db, DOC_A, 3);
    expect(await db.snapshots.get(DOC_A)).toBeDefined();
  });

  it("maps a failure to a typed reason", async () => {
    const broken = failingDb(db, domError("QuotaExceededError"));
    expect(await clearPending(broken, DOC_A, 1)).toEqual({ ok: false, reason: "quota" });
  });
});

describe("markState", () => {
  it("records a state for a document with no journal rows yet", async () => {
    const result = await markState(db, DOC_A, "RECOVERY_REQUIRED", "corrupt");
    expect(result).toEqual({
      ok: true,
      meta: {
        documentId: DOC_A,
        state: "RECOVERY_REQUIRED",
        localSeq: 0,
        lastError: "corrupt",
      },
    });
  });

  it("preserves the local sequence", async () => {
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("c"));
    await markState(db, DOC_A, "SYNCING");
    const meta = await db.meta.get(DOC_A);
    expect(meta?.localSeq).toBe(2);
  });

  it("clears lastError when no reason is given", async () => {
    await markState(db, DOC_A, "ERROR", "quota");
    await markState(db, DOC_A, "EDITING");
    const meta = await db.meta.get(DOC_A);
    expect(meta?.state).toBe("EDITING");
    expect(meta?.lastError).toBeUndefined();
  });

  it("does not touch the snapshot or the queue", async () => {
    await saveLocal(db, DOC_A, docWithText("tekst", uuidSeq()), 0, uuidSeq("b"));
    await markState(db, DOC_A, "CONFLICT");
    expect(await db.pending.where("documentId").equals(DOC_A).count()).toBe(1);
    expect((await db.snapshots.get(DOC_A))?.document.nodes[0].children[0]?.text).toBe(
      "tekst",
    );
  });

  it("maps a failure to a typed reason", async () => {
    const broken = failingDb(db, domError("DataError"));
    expect(await markState(broken, DOC_A, "SYNCED")).toEqual({
      ok: false,
      reason: "corrupt",
    });
  });
});

describe("reload restores the sticky states", () => {
  it.each(["CONFLICT", "RECOVERY_REQUIRED"] as const)(
    "brings %s back after the tab is closed and re-opened",
    async (state) => {
      await saveLocal(db, DOC_A, docWithText("rad", uuidSeq()), 0, uuidSeq("b"));
      await markState(db, DOC_A, state, "corrupt");

      // A "reload": a brand new handle on the same database name.
      await db.close();
      const reopened = new JournalDatabase(db.name);
      await reopened.open();
      const loaded = await loadJournal(reopened, DOC_A);
      if (!loaded.ok) {
        throw new Error("expected a successful load");
      }

      expect(restoreSyncState(loaded.contents)).toBe(state);
      expect(loaded.contents.meta?.lastError).toBe("corrupt");
      expect(loaded.contents.snapshot?.document.nodes[0].children[0]?.text).toBe("rad");
      await reopened.close();
      await db.open();
    },
  );

  it("does not downgrade a recorded conflict to LOCAL_DURABLE", async () => {
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    await markState(db, DOC_A, "CONFLICT");
    const loaded = await loadJournal(db, DOC_A);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(restoreSyncState(loaded.contents)).not.toBe("LOCAL_DURABLE");
  });

  it("resumes LOCAL_DURABLE after an ordinary save", async () => {
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    const loaded = await loadJournal(db, DOC_A);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(restoreSyncState(loaded.contents)).toBe("LOCAL_DURABLE");
  });

  it("starts a never-saved document in EDITING", async () => {
    const loaded = await loadJournal(db, DOC_B);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(restoreSyncState(loaded.contents)).toBe("EDITING");
  });

  it("lets a successful save clear a recorded ERROR", async () => {
    await markState(db, DOC_A, "ERROR", "quota");
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    const loaded = await loadJournal(db, DOC_A);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(restoreSyncState(loaded.contents)).toBe("LOCAL_DURABLE");
  });
});

describe("markSynced — recording a server ACK (F1-4b)", () => {
  it("moves the snapshot onto the revision the server named", async () => {
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    await clearPending(db, DOC_A, 1);

    const result = await markSynced(db, DOC_A, 5);
    expect(result.ok).toBe(true);

    const loaded = await loadJournal(db, DOC_A);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(loaded.contents.snapshot?.revision).toBe(5);
    expect(loaded.contents.meta?.state).toBe("SYNCED");
  });

  it("leaves the candidate itself untouched", async () => {
    const doc = docWithText("ostaje isti", uuidSeq());
    await saveLocal(db, DOC_A, doc, 0, uuidSeq("b"));
    await clearPending(db, DOC_A, 1);
    await markSynced(db, DOC_A, 2);

    const loaded = await loadJournal(db, DOC_A);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(loaded.contents.snapshot?.document).toEqual(doc);
  });

  it("refuses to claim SYNCED while rows are still owed to the server", async () => {
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("c"));
    await clearPending(db, DOC_A, 1);

    await markSynced(db, DOC_A, 3);

    const loaded = await loadJournal(db, DOC_A);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(loaded.contents.pending).toHaveLength(1);
    expect(loaded.contents.meta?.state).toBe("LOCAL_DURABLE");
    // The revision the server named still lands, so the next CAS is honest.
    expect(loaded.contents.snapshot?.revision).toBe(3);
  });

  it("keeps the local sequence as a high-water mark", async () => {
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("c"));
    await clearPending(db, DOC_A, 2);
    await markSynced(db, DOC_A, 1);

    const loaded = await loadJournal(db, DOC_A);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(loaded.contents.meta?.localSeq).toBe(2);
  });

  it("refuses a revision that is not a whole, safe number", async () => {
    await saveLocal(db, DOC_A, emptyDocument(uuidSeq()), 0, uuidSeq("b"));
    expect(await markSynced(db, DOC_A, 1.5)).toEqual({ ok: false, reason: "unknown" });
    expect(await markSynced(db, DOC_A, -1)).toEqual({ ok: false, reason: "unknown" });

    const loaded = await loadJournal(db, DOC_A);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(loaded.contents.snapshot?.revision).toBe(0);
  });

  it("writes meta even when nothing was ever journalled locally", async () => {
    const result = await markSynced(db, DOC_B, 4);
    expect(result.ok && result.meta.state).toBe("SYNCED");

    const loaded = await loadJournal(db, DOC_B);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    expect(loaded.contents.snapshot).toBeNull();
  });

  it("maps a failing store to a reason instead of throwing", async () => {
    const error = Object.assign(new Error("gone"), { name: "DatabaseClosedError" });
    expect(await markSynced(failingDb(db, error), DOC_A, 1)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

/* ------------------------------------------------------------- conflicts */

/** A conflict for `documentId`, with both versions and a fixed detection time. */
function conflictAt(
  detectedAt: string,
  options: { server?: CanonicalDocument | null; localText?: string } = {},
) {
  const record = buildConflictRecord(
    {
      documentId: DOC_A,
      localDocument: docWithText(options.localText ?? "moja verzija", uuidSeq("a")),
      localBaseRevision: 2,
      serverDocument:
        options.server === undefined
          ? docWithText("poslužiteljska verzija", uuidSeq("b"))
          : options.server,
      serverRevision: 7,
    },
    () => detectedAt,
  );
  return record;
}

/** A db whose `conflicts` table throws on every read — for the error mapping. */
function failingConflicts(db: JournalDatabase, error: unknown): JournalDb {
  return {
    snapshots: db.snapshots,
    pending: db.pending,
    meta: db.meta,
    conflicts: {
      where: () => {
        throw error;
      },
      put: () => Promise.reject(error),
    } as unknown as JournalDatabase["conflicts"],
    transaction: ((
      _mode: string,
      _table: unknown,
      scope: () => Promise<unknown>,
    ) => scope()) as unknown as JournalDatabase["transaction"],
  };
}

describe("schema v2 upgrade", () => {
  it("adds `conflicts` to an existing v1 journal without losing its rows", async () => {
    const name = `pisac-journal-upgrade-${dbCounter}`;

    // A journal exactly as schema v1 wrote it — no `conflicts` store at all.
    const v1 = new Dexie(name);
    v1.version(1).stores({
      snapshots: "documentId",
      pending: "[documentId+localSeq], documentId",
      meta: "documentId",
    });
    await v1.open();
    await v1.table("snapshots").put({
      documentId: DOC_A,
      revision: 3,
      document: docWithText("stari zapis", uuidSeq("f")),
      savedAt: "2026-09-18T09:00:00.000Z",
    });
    await v1.table("meta").put({ documentId: DOC_A, state: "LOCAL_DURABLE", localSeq: 4 });
    v1.close();

    // Opening it with the current class upgrades it in place.
    const upgraded = new JournalDatabase(name);
    await upgraded.open();
    try {
      expect(upgraded.verno).toBe(2);

      const loaded = await loadJournal(upgraded, DOC_A);
      if (!loaded.ok) {
        throw new Error("expected a successful load");
      }
      expect(loaded.contents.snapshot?.revision).toBe(3);
      expect(loaded.contents.meta?.localSeq).toBe(4);

      // And the new table is usable straight away.
      const recorded = await recordConflict(upgraded, conflictAt("2026-09-19T12:00:00.000Z"));
      expect(recorded.ok).toBe(true);
      const waiting = await loadUnresolvedConflict(upgraded, DOC_A);
      expect(waiting.ok && waiting.conflict?.localBaseRevision).toBe(2);
    } finally {
      await upgraded.delete();
    }
  });

  it("opens a fresh journal straight at v2 with all four stores", async () => {
    expect(db.verno).toBe(2);
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      "conflicts",
      "meta",
      "pending",
      "snapshots",
    ]);
  });
});

describe("recordConflict / loadUnresolvedConflict", () => {
  it("stores a conflict and reads it back unresolved", async () => {
    const record = conflictAt("2026-09-19T12:00:00.000Z");
    expect(await recordConflict(db, record)).toEqual({ ok: true, conflict: record });

    const loaded = await loadUnresolvedConflict(db, DOC_A);
    expect(loaded.ok && loaded.conflict).toEqual(record);
  });

  it("returns null when the document has no conflict", async () => {
    expect(await loadUnresolvedConflict(db, DOC_B)).toEqual({ ok: true, conflict: null });
  });

  it("keeps conflicts of different documents apart", async () => {
    await recordConflict(db, conflictAt("2026-09-19T12:00:00.000Z"));
    const loaded = await loadUnresolvedConflict(db, DOC_B);
    expect(loaded.ok && loaded.conflict).toBeNull();
  });

  it("keeps a second conflict as a second row, overwriting nothing", async () => {
    const first = conflictAt("2026-09-19T12:00:00.000Z", { localText: "prva" });
    const second = conflictAt("2026-09-19T12:30:00.000Z", { localText: "druga" });
    await recordConflict(db, first);
    await recordConflict(db, second);

    expect(await db.conflicts.count()).toBe(2);
    // The newest unresolved one is the one the author is being asked about.
    const loaded = await loadUnresolvedConflict(db, DOC_A);
    expect(loaded.ok && loaded.conflict?.detectedAt).toBe("2026-09-19T12:30:00.000Z");
  });

  it("re-recording the same detection is idempotent", async () => {
    const record = conflictAt("2026-09-19T12:00:00.000Z");
    await recordConflict(db, record);
    await recordConflict(db, record);

    expect(await db.conflicts.count()).toBe(1);
  });

  it("stores a conflict whose server document could not be fetched", async () => {
    await recordConflict(db, conflictAt("2026-09-19T12:00:00.000Z", { server: null }));

    const loaded = await loadUnresolvedConflict(db, DOC_A);
    expect(loaded.ok && loaded.conflict?.serverDocument).toBeNull();
    expect(loaded.ok && loaded.conflict?.serverRevision).toBe(7);
  });

  it("maps a failing store to a reason instead of throwing", async () => {
    const error = Object.assign(new Error("gone"), { name: "DatabaseClosedError" });
    expect(await loadUnresolvedConflict(failingConflicts(db, error), DOC_A)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await recordConflict(failingConflicts(db, error), conflictAt("x"))).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("markConflictResolved", () => {
  it("records the decision and KEEPS the row", async () => {
    await recordConflict(db, conflictAt("2026-09-19T12:00:00.000Z"));

    const resolved = await markConflictResolved(
      db,
      DOC_A,
      "discard",
      () => "2026-09-19T12:10:00.000Z",
    );

    expect(resolved.ok && resolved.conflict?.resolvedVia).toBe("discard");
    expect(resolved.ok && resolved.conflict?.resolvedAt).toBe("2026-09-19T12:10:00.000Z");
    // The constitution's rule: the conflict stays recorded after resolution.
    expect(await db.conflicts.count()).toBe(1);
  });

  it("keeps both versions on the resolved row", async () => {
    const record = conflictAt("2026-09-19T12:00:00.000Z");
    await recordConflict(db, record);
    await markConflictResolved(db, DOC_A, "discard");

    const stored = await db.conflicts.get([DOC_A, "2026-09-19T12:00:00.000Z"]);
    // Discarding drops the local change from the queue, never from the record.
    expect(stored?.localDocument).toEqual(record.localDocument);
    expect(stored?.serverDocument).toEqual(record.serverDocument);
  });

  it("takes the conflict out of the unresolved set", async () => {
    await recordConflict(db, conflictAt("2026-09-19T12:00:00.000Z"));
    await markConflictResolved(db, DOC_A, "rebase");

    expect(await loadUnresolvedConflict(db, DOC_A)).toEqual({ ok: true, conflict: null });
  });

  it("resolves the newest unresolved conflict and leaves older rows alone", async () => {
    await recordConflict(db, conflictAt("2026-09-19T12:00:00.000Z", { localText: "prva" }));
    await recordConflict(db, conflictAt("2026-09-19T12:30:00.000Z", { localText: "druga" }));

    await markConflictResolved(db, DOC_A, "rebase");

    const older = await db.conflicts.get([DOC_A, "2026-09-19T12:00:00.000Z"]);
    const newer = await db.conflicts.get([DOC_A, "2026-09-19T12:30:00.000Z"]);
    expect(newer?.resolvedVia).toBe("rebase");
    expect(older?.resolvedVia).toBeUndefined();
  });

  it("is a no-op, not a failure, when nothing is unresolved", async () => {
    expect(await markConflictResolved(db, DOC_A, "rebase")).toEqual({
      ok: true,
      conflict: null,
    });
  });

  it("maps a failing store to a reason instead of throwing", async () => {
    const error = Object.assign(new Error("broken"), { name: "DataError" });
    expect(await markConflictResolved(failingConflicts(db, error), DOC_A, "rebase")).toEqual({
      ok: false,
      reason: "corrupt",
    });
  });
});

describe("refreshConflictServerSide", () => {
  it("fills in a server document that could not be fetched at detection time", async () => {
    await recordConflict(db, conflictAt("2026-09-19T12:00:00.000Z", { server: null }));
    const server = docWithText("napokon stigla", uuidSeq("c"));

    const refreshed = await refreshConflictServerSide(db, DOC_A, async () => ({
      document: server,
      revision: 9,
    }));

    expect(refreshed.ok && refreshed.conflict?.serverDocument).toEqual(server);
    expect(refreshed.ok && refreshed.conflict?.serverRevision).toBe(9);
    // The stored row is updated too, not just the returned copy.
    const stored = await db.conflicts.get([DOC_A, "2026-09-19T12:00:00.000Z"]);
    expect(stored?.serverRevision).toBe(9);
  });

  it("leaves the row untouched when the fetch comes back empty", async () => {
    await recordConflict(db, conflictAt("2026-09-19T12:00:00.000Z", { server: null }));

    const refreshed = await refreshConflictServerSide(db, DOC_A, async () => null);

    expect(refreshed.ok && refreshed.conflict?.serverDocument).toBeNull();
    expect(refreshed.ok && refreshed.conflict?.serverRevision).toBe(7);
  });

  it("treats a throwing fetch as no answer at all", async () => {
    await recordConflict(db, conflictAt("2026-09-19T12:00:00.000Z", { server: null }));

    const refreshed = await refreshConflictServerSide(db, DOC_A, async () => {
      throw new Error("offline");
    });

    expect(refreshed.ok).toBe(true);
    expect(refreshed.ok && refreshed.conflict?.serverDocument).toBeNull();
  });

  it("does not resurrect a resolved conflict", async () => {
    await recordConflict(db, conflictAt("2026-09-19T12:00:00.000Z", { server: null }));
    await markConflictResolved(db, DOC_A, "rebase");

    const refreshed = await refreshConflictServerSide(db, DOC_A, async () => ({
      document: docWithText("kasno", uuidSeq("c")),
      revision: 11,
    }));

    expect(refreshed.ok && refreshed.conflict).toBeNull();
    const stored = await db.conflicts.get([DOC_A, "2026-09-19T12:00:00.000Z"]);
    expect(stored?.serverDocument).toBeNull();
  });
});

describe("adoptServerDocument", () => {
  it("replaces the snapshot, empties the queue and records SYNCED", async () => {
    await saveLocal(db, DOC_A, docWithText("moja", uuidSeq("d")), 2, uuidSeq("c"));
    await saveLocal(db, DOC_A, docWithText("moja opet", uuidSeq("d")), 2, uuidSeq("e"));
    const server = docWithText("poslužiteljska", uuidSeq("b"));

    const adopted = await adoptServerDocument(db, DOC_A, server, 7);

    expect(adopted.ok && adopted.cleared).toBe(2);
    const loaded = await loadJournal(db, DOC_A);
    if (!loaded.ok) {
      throw new Error("expected a successful load");
    }
    // The discarded local document must not survive in the snapshot: the next
    // visit resolves its initial document from there first.
    expect(loaded.contents.snapshot?.document).toEqual(server);
    expect(loaded.contents.snapshot?.revision).toBe(7);
    expect(loaded.contents.pending).toEqual([]);
    expect(loaded.contents.meta?.state).toBe("SYNCED");
    expect(restoreSyncState(loaded.contents)).toBe("SYNCED");
  });

  it("keeps the local sequence as a high-water mark", async () => {
    await saveLocal(db, DOC_A, docWithText("prva", uuidSeq("d")), 0, uuidSeq("c"));
    await saveLocal(db, DOC_A, docWithText("druga", uuidSeq("d")), 0, uuidSeq("e"));

    await adoptServerDocument(db, DOC_A, docWithText("server", uuidSeq("b")), 5);

    const loaded = await loadJournal(db, DOC_A);
    expect(loaded.ok && loaded.contents.meta?.localSeq).toBe(2);
  });

  it("refuses a revision that is not a whole, non-negative number", async () => {
    const server = docWithText("server", uuidSeq("b"));
    expect(await adoptServerDocument(db, DOC_A, server, 1.5)).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(await adoptServerDocument(db, DOC_A, server, -1)).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("leaves another document's queue alone", async () => {
    await saveLocal(db, DOC_B, docWithText("tuđa", uuidSeq("a")), 0, uuidSeq("f"));
    await saveLocal(db, DOC_A, docWithText("moja", uuidSeq("d")), 0, uuidSeq("c"));

    await adoptServerDocument(db, DOC_A, docWithText("server", uuidSeq("b")), 3);

    const other = await loadJournal(db, DOC_B);
    expect(other.ok && other.contents.pending.length).toBe(1);
  });

  it("maps a failing store to a reason instead of throwing", async () => {
    const error = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    expect(
      await adoptServerDocument(failingDb(db, error), DOC_A, docWithText("s", uuidSeq("b")), 1),
    ).toEqual({ ok: false, reason: "quota" });
  });
});
