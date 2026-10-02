import { describe, expect, it } from "vitest";

import {
  validateEvidenceIngestCommand,
  type EvidenceIngestCommand,
} from "./evidence-ingest";

const payload = "{\"events\":[]}";

function validCommand(): EvidenceIngestCommand {
  return {
    clientRequestId: "req-1",
    canonicalPayload: payload,
    descriptor: {
      documentId: "doc-1",
      sessionId: "session-1",
      segmentId: "segment-1",
      schema: "pisac-local-transactions-v1",
      eventCount: 0,
      startedAt: "2026-10-02T19:00:00Z",
      endedAt: "2026-10-02T19:01:00Z",
      segmentHash: "sha256:abc",
      previousSegmentHash: null,
      payloadBytes: new TextEncoder().encode(payload).byteLength,
    },
  };
}

describe("evidence ingest boundary", () => {
  it("accepts a structurally coherent segment envelope", () => {
    expect(validateEvidenceIngestCommand(validCommand())).toBe(true);
  });

  it("fails closed on payload-size or chronology mismatches", () => {
    expect(
      validateEvidenceIngestCommand({
        ...validCommand(),
        descriptor: { ...validCommand().descriptor, payloadBytes: 1 },
      }),
    ).toBe(false);

    expect(
      validateEvidenceIngestCommand({
        ...validCommand(),
        descriptor: {
          ...validCommand().descriptor,
          startedAt: "2026-10-02T19:02:00Z",
          endedAt: "2026-10-02T19:01:00Z",
        },
      }),
    ).toBe(false);
  });
});
