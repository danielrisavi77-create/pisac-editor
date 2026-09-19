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
  resetJournalDatabase,
  type JournalDb,
} from "./db";
import { loadJournal, markState, saveLocal, type ServerSide } from "./journal";
import { attemptJournalRecovery, executeRecovery } from "./recovery";

const DOC_A = "11111111-1111-4111-8111-111111111111";

function uuidSeq(prefix = "a"): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

function docWithText(text: string): CanonicalDocument {
  const empty = emptyDocument(uuidSeq("c"));
  return { ...empty, nodes: [paragraphNode(empty.nodes[0].id, [textNode(text)])] };
}

const LOCAL = docWithText("Moj nespremljeni tekst");
const SERVER = docWithText("Verzija s posluzitelja");

function serverAt(revision: number): () => Promise<ServerSide | null> {
  return async () => ({ document: SERVER, revision });
}

const noServer = async (): Promise<ServerSide | null> => null;
const throwingServer = async (): Promise<ServerSide | null> => {
  throw new Error("offline");
};

function domError(name: string): Error {
  const error = new Error(`simulated ${name}`);
  error.name = name;
  return error;
}

/** A store whose named tables throw on every read. */
function brokenReads(db: JournalDatabase, tables: ("snapshots" | "pending")[]): JournalDb {
  const thrower = {
    get: () => Promise.reject(domError("DataError")),
    where: () => {
      throw domError("DataError");
    },
  };
  return {
    snapshots: (tables.includes("snapshots")
      ? thrower
      : db.snapshots) as unknown as JournalDatabase["snapshots"],
    pending: (tables.includes("pending")
      ? thrower
      : db.pending) as unknown as JournalDatabase["pending"],
    meta: db.meta,
    conflicts: db.conflicts,
    transaction: db.transaction.bind(db) as JournalDatabase["transaction"],
  };
}

let db: JournalDatabase;
let dbCounter = 0;
let dbName: string;

beforeEach(async () => {
  dbCounter += 1;
  dbName = `pisac-recovery-test-${dbCounter}`;
  db = new JournalDatabase(dbName);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe("attemptJournalRecovery", () => {
  it("offers both versions when the journal still reads and the server answers", async () => {
    await saveLocal(db, DOC_A, LOCAL, 4, uuidSeq("b"));

    const report = await attemptJournalRecovery(db, DOC_A, serverAt(9));

    expect(report.journalUsable).toBe(true);
    expect(report.plan.canSalvageLocal).toBe(true);
    expect(report.plan.canAdoptServer).toBe(true);
    expect(report.plan.recommended).toBe("salvage-local");
    expect(report.plan.salvage?.document).toEqual(LOCAL);
    expect(report.plan.adopt?.revision).toBe(9);
  });

  it("offers the server's version only when the store cannot be opened at all", async () => {
    const report = await attemptJournalRecovery(null, DOC_A, serverAt(2));

    expect(report.journalUsable).toBe(false);
    expect(report.plan.canSalvageLocal).toBe(false);
    expect(
      report.plan.options.find((option) => option.choice === "salvage-local")?.blockedBy,
    ).toBe("journal-unreadable");
    expect(report.plan.recommended).toBe("adopt-server");
  });

  it("still salvages the queue when the snapshot table throws", async () => {
    await saveLocal(db, DOC_A, LOCAL, 4, uuidSeq("b"));

    const report = await attemptJournalRecovery(
      brokenReads(db, ["snapshots"]),
      DOC_A,
      noServer,
    );

    expect(report.plan.canSalvageLocal).toBe(true);
    expect(report.plan.salvage?.source).toBe("pending");
    // One read failed, so the store must not be written to as it stands.
    expect(report.journalUsable).toBe(false);
  });

  it("still salvages the snapshot when the pending table throws", async () => {
    await saveLocal(db, DOC_A, LOCAL, 4, uuidSeq("b"));

    const report = await attemptJournalRecovery(
      brokenReads(db, ["pending"]),
      DOC_A,
      noServer,
    );

    expect(report.plan.canSalvageLocal).toBe(true);
    expect(report.plan.salvage?.source).toBe("snapshot");
    expect(report.journalUsable).toBe(false);
  });

  it("reports an entirely unreadable store as unreadable, not as empty", async () => {
    const report = await attemptJournalRecovery(
      brokenReads(db, ["snapshots", "pending"]),
      DOC_A,
      noServer,
    );

    expect(
      report.plan.options.find((option) => option.choice === "salvage-local")?.blockedBy,
    ).toBe("journal-unreadable");
    expect(report.plan.recommended).toBeNull();
  });

  it("says a readable but empty journal is empty", async () => {
    const report = await attemptJournalRecovery(db, DOC_A, noServer);

    expect(report.journalUsable).toBe(true);
    expect(
      report.plan.options.find((option) => option.choice === "salvage-local")?.blockedBy,
    ).toBe("nothing-local");
  });

  it("treats a throwing server read as no answer at all", async () => {
    await saveLocal(db, DOC_A, LOCAL, 1, uuidSeq("b"));

    const report = await attemptJournalRecovery(db, DOC_A, throwingServer);

    expect(report.plan.canAdoptServer).toBe(false);
    expect(report.plan.canSalvageLocal).toBe(true);
  });
});

describe("executeRecovery — salvage-local", () => {
  it("writes the salvaged document back even though the journal is frozen", async () => {
    await saveLocal(db, DOC_A, LOCAL, 4, uuidSeq("b"));
    await markState(db, DOC_A, "RECOVERY_REQUIRED", "corrupt");

    const report = await attemptJournalRecovery(db, DOC_A, serverAt(9));
    const done = await executeRecovery(db, DOC_A, "salvage-local", report.plan, serverAt(9), dbName);

    expect(done.ok).toBe(true);
    if (!done.ok) {
      return;
    }
    expect(done.document).toEqual(LOCAL);
    expect(done.baseRevision).toBe(4);
    expect(done.databaseReset).toBe(false);

    const loaded = await loadJournal(db, DOC_A);
    expect(loaded.ok && loaded.contents.snapshot?.document).toEqual(LOCAL);
    // The write left the document owing the server, not claiming SYNCED.
    expect(loaded.ok && loaded.contents.meta?.state).toBe("LOCAL_DURABLE");
    expect(loaded.ok && loaded.contents.pending.length).toBeGreaterThan(0);
  });

  it("recreates the database when there is none to write to", async () => {
    const reset = `${dbName}-reset`;
    const stale = new JournalDatabase(reset);
    await stale.open();
    await saveLocal(stale, DOC_A, docWithText("stari sadrzaj"), 0, uuidSeq("d"));
    stale.close();

    const report = await attemptJournalRecovery(null, DOC_A, serverAt(3));
    // The plan has no local candidate, so salvage is refused before anything
    // destructive happens.
    expect(await executeRecovery(null, DOC_A, "salvage-local", report.plan, serverAt(3), reset)).toEqual(
      { ok: false, reason: "unavailable-choice" },
    );

    // With a candidate in hand (read before the store went bad), the reset is
    // the author's explicit choice and the salvaged text lands in a fresh db.
    const plan = (await attemptJournalRecovery(db, DOC_A, serverAt(3))).plan;
    await saveLocal(db, DOC_A, LOCAL, 4, uuidSeq("b"));
    const withLocal = (await attemptJournalRecovery(db, DOC_A, serverAt(3))).plan;
    expect(plan.canSalvageLocal).toBe(false);

    const done = await executeRecovery(null, DOC_A, "salvage-local", withLocal, serverAt(3), reset);
    expect(done.ok).toBe(true);
    if (!done.ok) {
      return;
    }
    expect(done.databaseReset).toBe(true);

    const fresh = await loadJournal(done.db, DOC_A);
    expect(fresh.ok && fresh.contents.snapshot?.document).toEqual(LOCAL);
    // The old, damaged contents are gone: a reset is destructive by design.
    expect(fresh.ok && fresh.contents.pending).toHaveLength(1);

    await new JournalDatabase(reset).delete();
  });

  it("refuses a salvage the plan does not offer", async () => {
    const report = await attemptJournalRecovery(db, DOC_A, noServer);

    expect(await executeRecovery(db, DOC_A, "salvage-local", report.plan, noServer, dbName)).toEqual(
      { ok: false, reason: "unavailable-choice" },
    );
  });
});

describe("executeRecovery — adopt-server", () => {
  it("adopts the server's document in one transaction and empties the queue", async () => {
    await saveLocal(db, DOC_A, LOCAL, 4, uuidSeq("b"));
    await markState(db, DOC_A, "RECOVERY_REQUIRED", "corrupt");

    const report = await attemptJournalRecovery(db, DOC_A, serverAt(9));
    const done = await executeRecovery(db, DOC_A, "adopt-server", report.plan, serverAt(9), dbName);

    expect(done.ok).toBe(true);
    if (!done.ok) {
      return;
    }
    expect(done.document).toEqual(SERVER);
    expect(done.baseRevision).toBe(9);

    const loaded = await loadJournal(db, DOC_A);
    expect(loaded.ok && loaded.contents.snapshot?.document).toEqual(SERVER);
    expect(loaded.ok && loaded.contents.snapshot?.revision).toBe(9);
    expect(loaded.ok && loaded.contents.pending).toHaveLength(0);
    expect(loaded.ok && loaded.contents.meta?.state).toBe("SYNCED");
  });

  it("re-reads the server and refuses rather than adopting a stale plan", async () => {
    await saveLocal(db, DOC_A, LOCAL, 4, uuidSeq("b"));
    const report = await attemptJournalRecovery(db, DOC_A, serverAt(9));

    expect(
      await executeRecovery(db, DOC_A, "adopt-server", report.plan, throwingServer, dbName),
    ).toEqual({ ok: false, reason: "server-unreadable" });

    // Nothing was written: the local text is still exactly where it was.
    const loaded = await loadJournal(db, DOC_A);
    expect(loaded.ok && loaded.contents.snapshot?.document).toEqual(LOCAL);
  });

  it("takes the revision from the fresh read, not from the plan", async () => {
    await saveLocal(db, DOC_A, LOCAL, 4, uuidSeq("b"));
    const report = await attemptJournalRecovery(db, DOC_A, serverAt(9));

    const done = await executeRecovery(db, DOC_A, "adopt-server", report.plan, serverAt(12), dbName);

    expect(done.ok && done.baseRevision).toBe(12);
  });

  it("refuses an adoption the plan does not offer", async () => {
    await saveLocal(db, DOC_A, LOCAL, 4, uuidSeq("b"));
    const report = await attemptJournalRecovery(db, DOC_A, noServer);

    expect(await executeRecovery(db, DOC_A, "adopt-server", report.plan, serverAt(1), dbName)).toEqual(
      { ok: false, reason: "unavailable-choice" },
    );
  });

  it("recreates the database when there is none, then adopts", async () => {
    const reset = `${dbName}-adopt`;
    const report = await attemptJournalRecovery(null, DOC_A, serverAt(6));

    const done = await executeRecovery(null, DOC_A, "adopt-server", report.plan, serverAt(6), reset);

    expect(done.ok).toBe(true);
    if (!done.ok) {
      return;
    }
    expect(done.databaseReset).toBe(true);

    const fresh = await loadJournal(done.db, DOC_A);
    expect(fresh.ok && fresh.contents.snapshot?.document).toEqual(SERVER);
    expect(fresh.ok && fresh.contents.meta?.state).toBe("SYNCED");

    await new JournalDatabase(reset).delete();
  });

  it("refuses a choice that is not one of the two", async () => {
    const report = await attemptJournalRecovery(db, DOC_A, serverAt(1));
    const rogue = "repair-magically" as unknown as "adopt-server";

    expect(await executeRecovery(db, DOC_A, rogue, report.plan, serverAt(1), dbName)).toEqual({
      ok: false,
      reason: "unavailable-choice",
    });
  });
});

describe("resetJournalDatabase", () => {
  it("deletes everything the store held and opens an empty one", async () => {
    const name = `${dbName}-wipe`;
    const victim = new JournalDatabase(name);
    await victim.open();
    await saveLocal(victim, DOC_A, LOCAL, 0, uuidSeq("e"));
    expect(await victim.snapshots.count()).toBe(1);
    victim.close();

    const reopened = await resetJournalDatabase(name);

    expect(reopened.ok).toBe(true);
    if (!reopened.ok) {
      return;
    }
    expect(await reopened.db.snapshots.count()).toBe(0);
    expect(await reopened.db.pending.count()).toBe(0);
    expect(await reopened.db.meta.count()).toBe(0);
    expect(await reopened.db.conflicts.count()).toBe(0);

    await reopened.db.delete();
  });
});
