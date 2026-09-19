// @vitest-environment node
import "fake-indexeddb/auto";

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
import { clearPending, loadJournal, markState, saveLocal } from "./journal";

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
