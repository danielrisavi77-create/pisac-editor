import { describe, expect, it } from "vitest";

import { emptyDocument, type DocumentTransaction } from "../document";
import {
  COMMIT_STATUSES,
  SERVER_SYNC_ERROR_MESSAGES,
  commitRequestFromTransaction,
  parseCommitOutcome,
  parseServerSyncErrorCode,
} from "./contract";

const DOC_ID = "9f1d8a52-5b6e-4a1a-9c0d-2f4b6e8a1c33";

function uuidSeq(): () => string {
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  let i = 0;
  return () => ids[i++ % ids.length];
}

function tx(overrides: Partial<DocumentTransaction> = {}): DocumentTransaction {
  return {
    kind: "REPLACE_DOCUMENT",
    clientTransactionId: "ctx-1",
    baseRevision: 3,
    document: emptyDocument(uuidSeq()),
    createdAt: "2026-09-19T10:00:00.000Z",
    ...overrides,
  };
}

describe("parseCommitOutcome — statuses the RPC can return", () => {
  it("parses a committed outcome with its revision", () => {
    expect(parseCommitOutcome({ status: "committed", revision: 7 })).toEqual({
      status: "committed",
      revision: 7,
    });
  });

  it("parses a duplicate outcome as an ACK for the revision the key already made", () => {
    expect(parseCommitOutcome({ status: "duplicate", revision: 7 })).toEqual({
      status: "duplicate",
      revision: 7,
    });
  });

  it("parses a stale base outcome and keeps the server's current revision", () => {
    expect(parseCommitOutcome({ status: "stale_base", currentRevision: 12 })).toEqual({
      status: "stale_base",
      currentRevision: 12,
    });
  });

  it("accepts currentRevision 0 — a document with no commit yet is not stale nonsense", () => {
    expect(parseCommitOutcome({ status: "stale_base", currentRevision: 0 })).toEqual({
      status: "stale_base",
      currentRevision: 0,
    });
  });

  it("parses the payload-free statuses", () => {
    for (const status of [
      "not_found",
      "unauthenticated",
      "invalid_document",
      "invalid_client_transaction_id",
    ] as const) {
      expect(parseCommitOutcome({ status })).toEqual({ status });
    }
  });

  it("covers every status the contract declares", () => {
    for (const status of COMMIT_STATUSES) {
      const raw =
        status === "committed" || status === "duplicate"
          ? { status, revision: 1 }
          : status === "stale_base"
            ? { status, currentRevision: 1 }
            : { status };
      expect(parseCommitOutcome(raw).status).toBe(status);
    }
  });
});

describe("parseCommitOutcome — malformed payloads", () => {
  it("rejects non-objects", () => {
    for (const raw of [null, undefined, 3, "committed", true, [], () => {}]) {
      expect(parseCommitOutcome(raw)).toEqual({ status: "invalid" });
    }
  });

  it("rejects an array that carries the right fields", () => {
    const arrayish = Object.assign([], { status: "committed", revision: 1 });
    expect(parseCommitOutcome(arrayish)).toEqual({ status: "invalid" });
  });

  it("rejects an unknown status", () => {
    expect(parseCommitOutcome({ status: "ok", revision: 1 })).toEqual({ status: "invalid" });
  });

  it("rejects a non-string status", () => {
    expect(parseCommitOutcome({ status: 1, revision: 1 })).toEqual({ status: "invalid" });
  });

  it("rejects a committed outcome without a revision", () => {
    expect(parseCommitOutcome({ status: "committed" })).toEqual({ status: "invalid" });
  });

  it("rejects revision 0 for a commit — a commit always advances past 0", () => {
    expect(parseCommitOutcome({ status: "committed", revision: 0 })).toEqual({
      status: "invalid",
    });
  });

  it("rejects a fractional, negative, infinite or unsafe revision instead of rounding it", () => {
    for (const revision of [1.5, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(parseCommitOutcome({ status: "committed", revision })).toEqual({
        status: "invalid",
      });
    }
  });

  it("rejects a revision sent as a string, as a bigint-ish driver might", () => {
    expect(parseCommitOutcome({ status: "committed", revision: "7" })).toEqual({
      status: "invalid",
    });
  });

  it("rejects a stale base outcome whose currentRevision is missing or negative", () => {
    expect(parseCommitOutcome({ status: "stale_base" })).toEqual({ status: "invalid" });
    expect(parseCommitOutcome({ status: "stale_base", currentRevision: -1 })).toEqual({
      status: "invalid",
    });
  });

  it("does not read a commit revision from the stale-base field, or the other way round", () => {
    expect(parseCommitOutcome({ status: "committed", currentRevision: 4 })).toEqual({
      status: "invalid",
    });
    expect(parseCommitOutcome({ status: "stale_base", revision: 4 })).toEqual({
      status: "invalid",
    });
  });
});

describe("parseCommitOutcome — prototype pollution attempts", () => {
  it("ignores a status inherited from the prototype", () => {
    const raw = Object.create({ status: "committed", revision: 1 });
    expect(parseCommitOutcome(raw)).toEqual({ status: "invalid" });
  });

  it("ignores a revision inherited from the prototype", () => {
    const raw = Object.create({ revision: 9 }) as Record<string, unknown>;
    raw.status = "committed";
    expect(parseCommitOutcome(raw)).toEqual({ status: "invalid" });
  });

  it("does not treat Object.prototype members as a status", () => {
    for (const status of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(parseCommitOutcome({ status })).toEqual({ status: "invalid" });
    }
  });

  it("accepts a JSON.parse'd payload carrying a literal __proto__ key", () => {
    const raw = JSON.parse('{"status":"committed","revision":2,"__proto__":{"x":1}}') as unknown;
    expect(parseCommitOutcome(raw)).toEqual({ status: "committed", revision: 2 });
  });

  it("does not let a polluted Object.prototype invent a revision", () => {
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto.revision = 42;
    try {
      expect(parseCommitOutcome({ status: "committed" })).toEqual({ status: "invalid" });
    } finally {
      delete proto.revision;
    }
  });

  it("rejects a class instance dressed as an outcome", () => {
    class Outcome {
      status = "committed";
      revision = 1;
    }
    expect(parseCommitOutcome(new Outcome())).toEqual({ status: "invalid" });
  });
});

describe("commitRequestFromTransaction", () => {
  it("maps a transaction onto the RPC argument names", () => {
    const transaction = tx();
    expect(commitRequestFromTransaction(DOC_ID, transaction)).toEqual({
      p_document_id: DOC_ID,
      p_base_revision: 3,
      p_document: transaction.document,
      p_client_transaction_id: "ctx-1",
    });
  });

  it("never sends an actor id — the RPC takes it from the session", () => {
    const request = commitRequestFromTransaction(DOC_ID, tx());
    expect(Object.keys(request ?? {}).sort()).toEqual([
      "p_base_revision",
      "p_client_transaction_id",
      "p_document",
      "p_document_id",
    ]);
  });

  it("passes base revision 0 through for the first commit", () => {
    expect(commitRequestFromTransaction(DOC_ID, tx({ baseRevision: 0 }))?.p_base_revision).toBe(0);
  });

  it("refuses a transaction of an unknown kind rather than sending it as a replacement", () => {
    const forged = { ...tx(), kind: "INSERT_TEXT" } as unknown as DocumentTransaction;
    expect(commitRequestFromTransaction(DOC_ID, forged)).toBeNull();
  });

  it("refuses an empty document id", () => {
    expect(commitRequestFromTransaction("", tx())).toBeNull();
  });

  it("refuses an empty or non-string client transaction id", () => {
    expect(commitRequestFromTransaction(DOC_ID, tx({ clientTransactionId: "" }))).toBeNull();
    const forged = { ...tx(), clientTransactionId: 7 } as unknown as DocumentTransaction;
    expect(commitRequestFromTransaction(DOC_ID, forged)).toBeNull();
  });

  it("refuses a fractional or negative base revision", () => {
    expect(commitRequestFromTransaction(DOC_ID, tx({ baseRevision: 1.5 }))).toBeNull();
    expect(commitRequestFromTransaction(DOC_ID, tx({ baseRevision: -1 }))).toBeNull();
  });
});

describe("SERVER_SYNC_ERROR_MESSAGES", () => {
  it("carries a non-empty Croatian message for every code", () => {
    const codes = Object.keys(SERVER_SYNC_ERROR_MESSAGES);
    expect(codes.length).toBeGreaterThanOrEqual(5);
    for (const message of Object.values(SERVER_SYNC_ERROR_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("never claims a save — durability is the chip's job, not a message", () => {
    for (const message of Object.values(SERVER_SYNC_ERROR_MESSAGES)) {
      expect(message.toLowerCase()).not.toContain("spremljeno");
    }
    for (const key of ["committed", "duplicate", "stale_base"]) {
      expect(Object.prototype.hasOwnProperty.call(SERVER_SYNC_ERROR_MESSAGES, key)).toBe(false);
    }
  });

  it("narrows a known code and refuses anything else", () => {
    expect(parseServerSyncErrorCode("slanje")).toBe("slanje");
    for (const raw of ["__proto__", "constructor", "toString", "nope", 7, null, undefined]) {
      expect(parseServerSyncErrorCode(raw)).toBeNull();
    }
  });
});
