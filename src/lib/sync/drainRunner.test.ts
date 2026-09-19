// @vitest-environment node
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  emptyDocument,
  paragraphNode,
  textNode,
  type CanonicalDocument,
  type DocumentTransaction,
} from "@/domain/document";
import type { DrainOutcome } from "@/domain/sync/drain";
import type { SyncEvent } from "@/domain/sync/states";

import { JournalDatabase } from "@/lib/journal/db";
import {
  loadJournal,
  loadUnresolvedConflict,
  markState,
  saveLocal,
  type FetchServerFn,
} from "@/lib/journal/journal";

import {
  createDrainRunner,
  type ConflictDetail,
  type DelayFn,
  type DrainRunner,
} from "./drainRunner";

const DOC = "11111111-1111-4111-8111-111111111111";

let dbIndex = 0;
let db: JournalDatabase;
let runners: DrainRunner[] = [];

beforeEach(async () => {
  dbIndex += 1;
  db = new JournalDatabase(`drain-runner-${dbIndex}`);
  await db.open();
  runners = [];
});

afterEach(async () => {
  for (const runner of runners) {
    runner.stop();
  }
  db.close();
  await db.delete();
});

function uuidSeq(prefix = "a"): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

function docWithText(text: string): CanonicalDocument {
  const empty = emptyDocument(uuidSeq());
  return { ...empty, nodes: [paragraphNode(empty.nodes[0].id, [textNode(text)])] };
}

function firstTextOf(doc: CanonicalDocument): string {
  const node = doc.nodes[0];
  if (node.type !== "paragraph") {
    return "";
  }
  const first = node.children[0];
  return first?.type === "text" ? first.text : "";
}

function firstText(tx: DocumentTransaction): string {
  return firstTextOf(tx.document);
}

/** Writes one durable candidate, exactly as the editor would. */
async function save(text: string, baseRevision = 0): Promise<number> {
  const result = await saveLocal(
    db,
    DOC,
    docWithText(text),
    baseRevision,
    uuidSeq(String.fromCharCode(97 + (dbIndex % 26))),
  );
  if (!result.ok) {
    throw new Error(`saveLocal failed: ${result.reason}`);
  }
  return result.localSeq;
}

type Scheduled = { ms: number; fn: () => void; done: boolean };

/**
 * A scheduler the test drives by hand: nothing fires until `fire()` is called,
 * so the backoff series can be asserted without waiting 15 seconds for it.
 */
function scheduler() {
  const queue: Scheduled[] = [];
  const delayFn: DelayFn = (ms, fn) => {
    const task: Scheduled = { ms, fn, done: false };
    queue.push(task);
    return () => {
      task.done = true;
    };
  };
  const next = (): Scheduled | null => queue.find((task) => !task.done) ?? null;
  return {
    delayFn,
    queue,
    /** Every delay booked so far, in order, cancelled ones included. */
    delays: (): number[] => queue.map((task) => task.ms),
    pending: (): number => queue.filter((task) => !task.done).length,
    fire(): void {
      const task = next();
      if (!task) {
        throw new Error("no timer is booked");
      }
      task.done = true;
      task.fn();
    },
    /** Fires the booked tick only if there is one. */
    fireIfAny(): boolean {
      const task = next();
      if (!task) {
        return false;
      }
      task.done = true;
      task.fn();
      return true;
    },
  };
}

/** Lets the runner's asynchronous work (IndexedDB, the commit stub) proceed. */
async function settle(turns = 40): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function until(predicate: () => boolean, turns = 400): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was never met");
}

/** A promise the test resolves by hand, to hold a commit open mid-flight. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

type Harness = {
  runner: DrainRunner;
  clock: ReturnType<typeof scheduler>;
  events: SyncEvent[];
  revisions: number[];
  sent: DocumentTransaction[];
};

/** Builds a runner with a hand-driven clock, a fixed jitter and a commit stub. */
function harness(
  respond: (tx: DocumentTransaction, call: number) => Promise<DrainOutcome>,
  options: { fetchServer?: FetchServerFn } = {},
): Harness {
  const clock = scheduler();
  const events: SyncEvent[] = [];
  const revisions: number[] = [];
  const sent: DocumentTransaction[] = [];

  const runner = createDrainRunner({
    db,
    documentId: DOC,
    commit: (tx) => {
      sent.push(tx);
      return respond(tx, sent.length);
    },
    dispatch: (event) => events.push(event),
    onServerRevision: (revision) => revisions.push(revision),
    fetchServer: options.fetchServer,
    delayFn: clock.delayFn,
    // No jitter: the backoff series is asserted exactly.
    jitterFn: () => 0.5,
  });
  runners.push(runner);

  return { runner, clock, events, revisions, sent };
}

const committed = (revision: number) => async (): Promise<DrainOutcome> => ({
  status: "committed",
  revision,
});

describe("createDrainRunner — the happy path", () => {
  it("sends the queued transaction, ACKs it, clears it and bumps the revision", async () => {
    await save("prvi odlomak");

    const h = harness(committed(1));
    h.clock.fire();
    await until(() => h.revisions.length === 1);

    expect(h.sent).toHaveLength(1);
    expect(firstText(h.sent[0])).toBe("prvi odlomak");
    expect(h.events).toEqual([{ type: "SYNC_STARTED" }, { type: "SYNC_ACK" }]);
    expect(h.revisions).toEqual([1]);

    const loaded = await loadJournal(db, DOC);
    expect(loaded.ok && loaded.contents.pending).toEqual([]);
    expect(loaded.ok && loaded.contents.snapshot?.revision).toBe(1);
    expect(loaded.ok && loaded.contents.meta?.state).toBe("SYNCED");
    // The local sequence is a high-water mark; an ACK must not rewind it.
    expect(loaded.ok && loaded.contents.meta?.localSeq).toBe(1);
  });

  it("sends only the newest pending row and clears the superseded ones", async () => {
    await save("prva");
    await save("druga");
    await save("treća");

    const h = harness(committed(4));
    h.clock.fire();
    await until(() => h.revisions.length === 1);

    expect(h.sent).toHaveLength(1);
    expect(firstText(h.sent[0])).toBe("treća");

    const loaded = await loadJournal(db, DOC);
    expect(loaded.ok && loaded.contents.pending).toEqual([]);
    expect(loaded.ok && loaded.contents.snapshot?.revision).toBe(4);
  });

  it("drains rows a previous session left behind, with no local save at all", async () => {
    await save("od prošli put");

    const h = harness(committed(2));
    // The only timer is the one booked when the runner was created.
    expect(h.clock.pending()).toBe(1);
    h.clock.fire();
    await until(() => h.revisions.length === 1);

    expect(h.sent).toHaveLength(1);
    expect(h.revisions).toEqual([2]);
  });

  it("drains again after a later local save", async () => {
    const h = harness(committed(1));
    h.clock.fire();
    await settle();
    expect(h.sent).toHaveLength(0);

    await save("kasniji tekst");
    h.runner.notifyLocalSave();
    h.clock.fire();
    await until(() => h.revisions.length === 1);

    expect(h.sent).toHaveLength(1);
  });

  it("does nothing at all when the queue is empty", async () => {
    const h = harness(committed(1));
    h.clock.fire();
    await settle();

    expect(h.sent).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.clock.pending()).toBe(0);
  });
});

describe("createDrainRunner — a lost response", () => {
  it("treats a duplicate as an ACK: the replay found the commit already there", async () => {
    await save("poslano pa izgubljeno");

    const h = harness(async () => ({ status: "duplicate", revision: 7 }));
    h.clock.fire();
    await until(() => h.revisions.length === 1);

    expect(h.events).toEqual([{ type: "SYNC_STARTED" }, { type: "SYNC_ACK" }]);
    expect(h.revisions).toEqual([7]);

    const loaded = await loadJournal(db, DOC);
    expect(loaded.ok && loaded.contents.pending).toEqual([]);
    expect(loaded.ok && loaded.contents.snapshot?.revision).toBe(7);
    expect(loaded.ok && loaded.contents.meta?.state).toBe("SYNCED");
  });

  it("replays the very same idempotency key after a transport failure", async () => {
    await save("jednom pa opet");

    const h = harness(async (_tx, call) =>
      call === 1 ? { status: "transport_error" } : { status: "duplicate", revision: 3 },
    );
    h.clock.fire();
    await until(() => h.sent.length === 1);
    h.clock.fire();
    await until(() => h.revisions.length === 1);

    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].clientTransactionId).toBe(h.sent[0].clientTransactionId);
    expect(h.revisions).toEqual([3]);
  });
});

describe("createDrainRunner — retry with backoff", () => {
  it("books 1s, 2s then 4s after consecutive transport errors", async () => {
    await save("bez mreže");

    const h = harness(async () => ({ status: "transport_error" }));
    h.clock.fire();
    await until(() => h.sent.length === 1);
    h.clock.fire();
    await until(() => h.sent.length === 2);
    h.clock.fire();
    await until(() => h.sent.length === 3);

    // The first entry is the tick booked when the runner was created.
    expect(h.clock.delays()).toEqual([1000, 1000, 2000, 4000]);
    expect(h.events).toEqual([
      { type: "SYNC_STARTED" },
      { type: "SYNC_FAILED", retryable: true },
      { type: "SYNC_STARTED" },
      { type: "SYNC_FAILED", retryable: true },
      { type: "SYNC_STARTED" },
      { type: "SYNC_FAILED", retryable: true },
    ]);
  });

  it("keeps the queue while the server is unreachable", async () => {
    await save("čeka mrežu");

    const h = harness(async () => ({ status: "transport_error" }));
    h.clock.fire();
    await until(() => h.sent.length === 1);

    const loaded = await loadJournal(db, DOC);
    expect(loaded.ok && loaded.contents.pending).toHaveLength(1);
    expect(h.revisions).toEqual([]);
  });

  it("treats a commit that throws as a transport error, not a crash", async () => {
    await save("iznimka");

    const h = harness(async () => {
      throw new Error("fetch failed");
    });
    h.clock.fire();
    await until(() => h.sent.length === 1);

    expect(h.events.at(-1)).toEqual({ type: "SYNC_FAILED", retryable: true });
    expect(h.clock.delays().at(-1)).toBe(1000);
  });

  it("resets the backoff after a success", async () => {
    await save("prekid pa uspjeh");

    const h = harness(async (_tx, call) => {
      if (call === 1 || call === 2) {
        return { status: "transport_error" };
      }
      if (call === 3) {
        return { status: "committed", revision: 1 };
      }
      return { status: "transport_error" };
    });

    h.clock.fire();
    await until(() => h.sent.length === 1);
    h.clock.fire();
    await until(() => h.sent.length === 2);
    h.clock.fire();
    await until(() => h.revisions.length === 1);

    // A fresh candidate, and the next failure starts the series over at 1s.
    await save("novi tekst", 1);
    h.runner.notifyLocalSave();
    h.clock.fire();
    await until(() => h.sent.length === 4);

    expect(h.clock.delays()).toEqual([1000, 1000, 2000, 1000, 1000]);
  });

  it("a new local save preempts a long backoff instead of waiting it out", async () => {
    await save("prvi pokušaj");

    const h = harness(async (_tx, call) =>
      call <= 5 ? { status: "transport_error" } : { status: "committed", revision: 1 },
    );

    for (let i = 0; i < 5; i += 1) {
      h.clock.fire();
      await until(() => h.sent.length === i + 1);
    }
    expect(h.clock.delays().at(-1)).toBe(16000);

    await save("novi tekst");
    h.runner.notifyLocalSave();
    // The 16s retry was cancelled in favour of a 1s tick.
    expect(h.clock.delays().at(-1)).toBe(1000);
    expect(h.clock.pending()).toBe(1);
  });
});

describe("createDrainRunner — failures that must not be retried", () => {
  it("stops on a stale base and leaves the queue for the author to resolve", async () => {
    await save("dok je netko drugi pisao");

    const h = harness(async () => ({ status: "stale_base", currentRevision: 9 }));
    h.clock.fire();
    await until(() => h.sent.length === 1);
    await settle();

    expect(h.events).toEqual([{ type: "SYNC_STARTED" }, { type: "SYNC_STALE_BASE" }]);
    expect(h.clock.pending()).toBe(0);

    const loaded = await loadJournal(db, DOC);
    expect(loaded.ok && loaded.contents.pending).toHaveLength(1);
    expect(h.revisions).toEqual([]);
  });

  it("stays stopped after a stale base even when the author keeps saving", async () => {
    await save("konflikt");

    const h = harness(async () => ({ status: "stale_base", currentRevision: 9 }));
    h.clock.fire();
    await until(() => h.sent.length === 1);

    await save("još teksta");
    h.runner.notifyLocalSave();
    expect(h.clock.pending()).toBe(0);
    await settle();
    expect(h.sent).toHaveLength(1);
  });

  it("stops on a non-retryable server answer and books no retry", async () => {
    await save("prevelik dokument");

    const h = harness(async () => ({ status: "too_large" }));
    h.clock.fire();
    await until(() => h.sent.length === 1);
    await settle();

    expect(h.events).toEqual([
      { type: "SYNC_STARTED" },
      { type: "SYNC_FAILED", retryable: false },
    ]);
    expect(h.clock.pending()).toBe(0);
  });

  it("tries again once the author has saved something new after a fatal answer", async () => {
    await save("prevelik dokument");

    const h = harness(async (_tx, call) =>
      call === 1 ? { status: "too_large" } : { status: "committed", revision: 1 },
    );
    h.clock.fire();
    await until(() => h.sent.length === 1);

    await save("kraći dokument");
    h.runner.notifyLocalSave();
    h.clock.fire();
    await until(() => h.revisions.length === 1);

    expect(h.sent).toHaveLength(2);
    expect(firstText(h.sent[1])).toBe("kraći dokument");
  });

  it("still drains content saved while a fatal attempt was in flight", async () => {
    await save("prevelik dokument");

    const gate = deferred();
    const h = harness(async (_tx, call) => {
      if (call === 1) {
        await gate.promise;
        return { status: "too_large" };
      }
      return { status: "committed", revision: 1 };
    });

    h.clock.fire();
    await until(() => h.sent.length === 1);
    await save("kraći dokument");
    h.runner.notifyLocalSave();
    gate.release();
    await until(() => h.clock.pending() === 1);

    h.clock.fire();
    await until(() => h.revisions.length === 1);
    expect(firstText(h.sent[1])).toBe("kraći dokument");
  });

  it("does not resume mid-flight saves after a stale base — the author decides", async () => {
    await save("sporno");

    const gate = deferred();
    const h = harness(async () => {
      await gate.promise;
      return { status: "stale_base", currentRevision: 4 };
    });

    h.clock.fire();
    await until(() => h.sent.length === 1);
    await save("još teksta");
    h.runner.notifyLocalSave();
    gate.release();
    await settle();

    expect(h.clock.pending()).toBe(0);
    expect(h.sent).toHaveLength(1);
  });

  it("never drains a document the journal records as being in CONFLICT", async () => {
    await save("sporni tekst");
    await markState(db, DOC, "CONFLICT");

    const h = harness(committed(1));
    h.clock.fire();
    await settle();

    expect(h.sent).toEqual([]);
    expect(h.events).toEqual([]);
  });
});

describe("createDrainRunner — coalescing, single flight and teardown", () => {
  it("coalesces a burst of local saves into one drain", async () => {
    const h = harness(committed(1));
    h.clock.fire();
    await settle();

    for (const text of ["a", "ab", "abc", "abcd", "abcde"]) {
      await save(text);
      h.runner.notifyLocalSave();
    }
    expect(h.clock.pending()).toBe(1);

    h.clock.fire();
    await until(() => h.revisions.length === 1);

    expect(h.sent).toHaveLength(1);
    expect(firstText(h.sent[0])).toBe("abcde");
  });

  it("never runs two ticks at once, and comes back for what arrived mid-flight", async () => {
    await save("prvo");

    const gate = deferred();

    const h = harness(async (_tx, call) => {
      if (call === 1) {
        await gate.promise;
        return { status: "committed", revision: 1 };
      }
      return { status: "committed", revision: 2 };
    });

    h.clock.fire();
    await until(() => h.sent.length === 1);

    // A save lands while the round trip is still open.
    await save("drugo", 0);
    h.runner.notifyLocalSave();
    expect(h.clock.pending()).toBe(0);
    expect(h.sent).toHaveLength(1);

    gate.release();
    await until(() => h.revisions.length === 1);
    expect(h.clock.pending()).toBe(1);

    h.clock.fire();
    await until(() => h.revisions.length === 2);
    expect(h.sent).toHaveLength(2);
    expect(firstText(h.sent[1])).toBe("drugo");
  });

  it("fast-forwards a row queued mid-flight onto the revision our own ACK named", async () => {
    await save("prvo");

    const gate = deferred();

    const h = harness(async (_tx, call) => {
      if (call === 1) {
        await gate.promise;
        return { status: "committed", revision: 1 };
      }
      return { status: "committed", revision: 2 };
    });

    h.clock.fire();
    await until(() => h.sent.length === 1);
    // Written with the base that was current when the commit left: 0.
    await save("drugo", 0);
    h.runner.notifyLocalSave();
    gate.release();
    await until(() => h.revisions.length === 1);

    h.clock.fire();
    await until(() => h.sent.length === 2);

    expect(h.sent[0].baseRevision).toBe(0);
    // Not 0: rebasing onto OUR OWN acknowledged revision is not last-write-wins.
    expect(h.sent[1].baseRevision).toBe(1);
  });

  it("records LOCAL_DURABLE, not SYNCED, while newer rows are still owed", async () => {
    await save("prvo");

    const gate = deferred();

    const h = harness(async (_tx, call) => {
      if (call === 1) {
        await gate.promise;
        return { status: "committed", revision: 1 };
      }
      return { status: "committed", revision: 2 };
    });

    h.clock.fire();
    await until(() => h.sent.length === 1);
    await save("drugo", 0);
    h.runner.notifyLocalSave();
    gate.release();
    await until(() => h.revisions.length === 1);

    const loaded = await loadJournal(db, DOC);
    expect(loaded.ok && loaded.contents.pending).toHaveLength(1);
    expect(loaded.ok && loaded.contents.meta?.state).toBe("LOCAL_DURABLE");
    // The revision the server named still lands on the snapshot.
    expect(loaded.ok && loaded.contents.snapshot?.revision).toBe(1);
  });

  it("stop() cancels the booked tick, so nothing is ever sent", async () => {
    await save("neposlano");

    const h = harness(committed(1));
    h.runner.stop();
    expect(h.clock.fireIfAny()).toBe(false);
    await settle();

    expect(h.sent).toEqual([]);
    const loaded = await loadJournal(db, DOC);
    expect(loaded.ok && loaded.contents.pending).toHaveLength(1);
  });

  it("stop() mid-flight drops the answer: no event, no journal write", async () => {
    await save("u letu");

    const gate = deferred();

    const h = harness(async () => {
      await gate.promise;
      return { status: "committed", revision: 1 };
    });

    h.clock.fire();
    await until(() => h.sent.length === 1);
    h.runner.stop();
    gate.release();
    await settle();

    expect(h.events).toEqual([{ type: "SYNC_STARTED" }]);
    expect(h.revisions).toEqual([]);
    const loaded = await loadJournal(db, DOC);
    expect(loaded.ok && loaded.contents.pending).toHaveLength(1);
  });

  it("ignores notifyLocalSave after stop()", async () => {
    await save("nakon gašenja");

    const h = harness(committed(1));
    h.runner.stop();
    h.runner.notifyLocalSave();

    expect(h.clock.pending()).toBe(0);
    await settle();
    expect(h.sent).toEqual([]);
  });
});

describe("createDrainRunner — recording the conflict (F1-5a)", () => {
  const serverSide = () => ({
    document: docWithText("verzija s poslužitelja"),
    revision: 9,
  });

  it("records the conflict BEFORE the state machine is told about it", async () => {
    await save("moja verzija", 4);

    // The read is started from inside the dispatch, so it can only find a row
    // that was already written when SYNC_STALE_BASE was announced.
    const captured: {
      promise: ReturnType<typeof loadUnresolvedConflict> | null;
    } = { promise: null };
    const clock = scheduler();
    const events: SyncEvent[] = [];
    const runner = createDrainRunner({
      db,
      documentId: DOC,
      commit: async () => ({ status: "stale_base", currentRevision: 9 }),
      dispatch: (event) => {
        events.push(event);
        if (event.type === "SYNC_STALE_BASE") {
          captured.promise = loadUnresolvedConflict(db, DOC);
        }
      },
      onServerRevision: () => {},
      fetchServer: async () => serverSide(),
      delayFn: clock.delayFn,
      jitterFn: () => 0.5,
    });
    runners.push(runner);

    clock.fire();
    await until(() => events.some((event) => event.type === "SYNC_STALE_BASE"));
    const found = await captured.promise;

    if (!found?.ok) {
      throw new Error("expected the conflict to be readable at dispatch time");
    }
    expect(found.conflict).not.toBeNull();
    expect(found.conflict?.serverRevision).toBe(9);
  });

  it("keeps both versions, the stale base and the server's revision", async () => {
    await save("moja verzija", 4);

    const h = harness(async () => ({ status: "stale_base", currentRevision: 9 }), {
      fetchServer: async () => serverSide(),
    });
    h.clock.fire();
    await until(() => h.sent.length === 1);
    await settle();

    const loaded = await loadUnresolvedConflict(db, DOC);
    if (!loaded.ok || !loaded.conflict) {
      throw new Error("expected a recorded conflict");
    }
    expect(firstTextOf(loaded.conflict.localDocument)).toBe("moja verzija");
    expect(loaded.conflict.localBaseRevision).toBe(4);
    expect(loaded.conflict.serverDocument).not.toBeNull();
    expect(loaded.conflict.serverRevision).toBe(9);
    expect(loaded.conflict.resolvedVia).toBeUndefined();
  });

  it("still records the conflict when the server document cannot be fetched", async () => {
    await save("moja verzija", 4);

    const h = harness(async () => ({ status: "stale_base", currentRevision: 9 }), {
      fetchServer: async () => null,
    });
    h.clock.fire();
    await until(() => h.sent.length === 1);
    await settle();

    const loaded = await loadUnresolvedConflict(db, DOC);
    expect(loaded.ok && loaded.conflict?.serverDocument).toBeNull();
    // The refusal itself carries the revision, so that half is still known.
    expect(loaded.ok && loaded.conflict?.serverRevision).toBe(9);
    // And the author is still told: the claim is never swallowed.
    expect(h.events).toEqual([{ type: "SYNC_STARTED" }, { type: "SYNC_STALE_BASE" }]);
  });

  it("treats a throwing fetch as no answer, not as a crash", async () => {
    await save("moja verzija", 4);

    const h = harness(async () => ({ status: "stale_base", currentRevision: 7 }), {
      fetchServer: async () => {
        throw new Error("offline");
      },
    });
    h.clock.fire();
    await until(() => h.sent.length === 1);
    await settle();

    const loaded = await loadUnresolvedConflict(db, DOC);
    expect(loaded.ok && loaded.conflict?.serverDocument).toBeNull();
    expect(h.events).toEqual([{ type: "SYNC_STARTED" }, { type: "SYNC_STALE_BASE" }]);
  });

  it("records a conflict even with no fetcher wired at all", async () => {
    await save("moja verzija", 2);

    const h = harness(async () => ({ status: "stale_base", currentRevision: 5 }));
    h.clock.fire();
    await until(() => h.sent.length === 1);
    await settle();

    const loaded = await loadUnresolvedConflict(db, DOC);
    expect(loaded.ok && loaded.conflict?.serverDocument).toBeNull();
    expect(loaded.ok && loaded.conflict?.localBaseRevision).toBe(2);
  });

  it("leaves the queue alone: nothing is resolved on the author's behalf", async () => {
    await save("moja verzija", 4);

    const h = harness(async () => ({ status: "stale_base", currentRevision: 9 }), {
      fetchServer: async () => serverSide(),
    });
    h.clock.fire();
    await until(() => h.sent.length === 1);
    await settle();

    const loaded = await loadJournal(db, DOC);
    expect(loaded.ok && loaded.contents.pending).toHaveLength(1);
    expect(h.revisions).toEqual([]);
    expect(h.clock.pending()).toBe(0);
  });

  it("records a second conflict as a second row when one is raised again", async () => {
    await save("prva verzija", 4);

    const h = harness(async () => ({ status: "stale_base", currentRevision: 9 }), {
      fetchServer: async () => serverSide(),
    });
    h.clock.fire();
    await until(() => h.sent.length === 1);
    await settle();

    // The author rebases: a new candidate, and the halt is lifted explicitly.
    await save("rebazirana verzija", 9);
    h.runner.resumeAfterConflict();
    h.clock.fire();
    await until(() => h.sent.length === 2);
    await settle();

    expect(await db.conflicts.count()).toBe(2);
  });
});

describe("createDrainRunner — leaving a conflict", () => {
  it("resumes only on an explicit resolution, never on a new save", async () => {
    await save("konflikt", 1);

    const h = harness(
      async (_tx, call) =>
        call === 1
          ? { status: "stale_base", currentRevision: 9 }
          : { status: "committed", revision: 10 },
      { fetchServer: async () => ({ document: docWithText("njihovo"), revision: 9 }) },
    );
    h.clock.fire();
    await until(() => h.sent.length === 1);
    await settle();

    // Typing is not a decision: the drain stays put.
    await save("još teksta", 1);
    h.runner.notifyLocalSave();
    expect(h.clock.pending()).toBe(0);
    await settle();
    expect(h.sent).toHaveLength(1);

    // The author's explicit choice is.
    h.runner.resumeAfterConflict();
    expect(h.clock.pending()).toBe(1);
    h.clock.fire();
    await until(() => h.revisions.length === 1);
    expect(h.sent).toHaveLength(2);
    expect(h.revisions).toEqual([10]);
  });

  it("is a no-op when the runner is not halted on a conflict", async () => {
    await save("bez sukoba");

    const h = harness(committed(1));
    h.clock.fire();
    await until(() => h.revisions.length === 1);
    await settle();

    const booked = h.clock.delays().length;
    h.runner.resumeAfterConflict();
    // Nothing to resume, so nothing is scheduled.
    expect(h.clock.delays().length).toBe(booked);
  });

  it("does not resume a runner that has been stopped", async () => {
    await save("konflikt");

    const h = harness(async () => ({ status: "stale_base", currentRevision: 3 }));
    h.clock.fire();
    await until(() => h.sent.length === 1);
    await settle();

    h.runner.stop();
    h.runner.resumeAfterConflict();
    expect(h.clock.pending()).toBe(0);
  });
});

describe("createDrainRunner — reporting the conflict to the UI", () => {
  function conflictHarness(
    fetchServer: FetchServerFn | undefined,
    db2: JournalDatabase = db,
  ) {
    const clock = scheduler();
    const seen: ConflictDetail[] = [];
    const runner = createDrainRunner({
      db: db2,
      documentId: DOC,
      commit: async () => ({ status: "stale_base", currentRevision: 9 }),
      dispatch: () => {},
      onServerRevision: () => {},
      fetchServer,
      onConflict: (detail) => seen.push(detail),
      delayFn: clock.delayFn,
      jitterFn: () => 0.5,
    });
    runners.push(runner);
    return { clock, seen, runner };
  }

  it("reports both versions' coordinates when the conflict was recorded", async () => {
    await save("moja verzija", 4);

    const h = conflictHarness(async () => ({
      document: docWithText("njihova"),
      revision: 9,
    }));
    h.clock.fire();
    await until(() => h.seen.length === 1);

    expect(h.seen[0]).toMatchObject({
      documentId: DOC,
      localBaseRevision: 4,
      serverRevision: 9,
      recorded: true,
      serverDocumentFetched: true,
    });
    expect(firstTextOf(h.seen[0].localDocument)).toBe("moja verzija");
  });

  it("still reports the server revision when the record could not be written", async () => {
    await save("moja verzija", 4);

    // A journal whose conflicts table refuses every write: the state machine
    // must still reach CONFLICT, and the UI must still get a way out.
    const broken = {
      snapshots: db.snapshots,
      pending: db.pending,
      meta: db.meta,
      conflicts: db.conflicts,
      transaction: ((mode: string, ...rest: unknown[]) => {
        const table = rest[0];
        if (table === db.conflicts) {
          return Promise.reject(Object.assign(new Error("full"), {
            name: "QuotaExceededError",
          }));
        }
        return (db.transaction as unknown as (...args: unknown[]) => Promise<unknown>)(
          mode,
          ...rest,
        );
      }) as unknown as JournalDatabase["transaction"],
    } as unknown as JournalDatabase;

    const h = conflictHarness(async () => null, broken);
    h.clock.fire();
    await until(() => h.seen.length === 1);

    expect(h.seen[0].recorded).toBe(false);
    expect(h.seen[0].serverDocumentFetched).toBe(false);
    // The revision the refusal itself carried: enough for an explicit rebase.
    expect(h.seen[0].serverRevision).toBe(9);
  });

  it("reports the fetched revision when it is ahead of the refusal's", async () => {
    await save("moja verzija", 4);

    const h = conflictHarness(async () => ({
      document: docWithText("njihova"),
      revision: 11,
    }));
    h.clock.fire();
    await until(() => h.seen.length === 1);

    expect(h.seen[0].serverRevision).toBe(11);
  });

  it("says nothing to a runner that has been stopped", async () => {
    await save("moja verzija", 4);

    const h = conflictHarness(async () => {
      h.runner.stop();
      return null;
    });
    h.clock.fire();
    await settle();

    expect(h.seen).toEqual([]);
  });
});
