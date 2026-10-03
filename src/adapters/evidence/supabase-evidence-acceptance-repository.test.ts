import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  type EvidenceSegmentV2,
} from "@/domain/forensics/evidence-segment-v2";
import { buildEvidenceIngestCommandV2 } from "@/application/evidence/evidence-outbox";
import {
  EVIDENCE_RECEIPT_SCHEMA_V1,
  type SignedEvidenceReceipt,
} from "@/domain/forensics/evidence-receipt";
import { SupabaseEvidenceAcceptanceRepository } from "./supabase-evidence-acceptance-repository";

const PACKAGE = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const RECEIPT = "44444444-4444-4444-8444-444444444444";
const A = "a".repeat(64);
const B = "b".repeat(64);

function segment(): EvidenceSegmentV2 {
  return {
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: DOCUMENT,
    sessionId: "session-1",
    segmentId: "segment-1",
    sequenceFrom: 1,
    sequenceTo: 1,
    observedStartedAt: "2026-10-03T06:00:00.000Z",
    observedEndedAt: "2026-10-03T06:00:01.000Z",
    initialDocumentHash: A,
    finalDocumentHash: B,
    predecessorSegmentHash: null,
    events: [
      {
        sequence: 1,
        occurredAt: "2026-10-03T06:00:00.500Z",
        elapsedMs: 500,
        source: "editor",
        steps: [{ stepType: "replace", from: 1, to: 1 }],
        beforeDocumentHash: A,
        afterDocumentHash: B,
      },
    ],
    captureContext: {
      editorModel: "prosemirror",
      transactionFormat: "prosemirror-step-json-v1",
    },
    evidenceProfileId: "standard-v1",
  };
}

async function fixtureRecord(status: "pending_signature" | "signed") {
  const command = await buildEvidenceIngestCommandV2({
    evidencePackageId: PACKAGE,
    clientRequestId: "request-1",
    segment: segment(),
  });

  const payload = {
    receiptSchema: EVIDENCE_RECEIPT_SCHEMA_V1,
    receiptId: RECEIPT,
    evidencePackageId: PACKAGE,
    documentId: DOCUMENT,
    sessionId: "session-1",
    segmentId: "segment-1",
    segmentHash: command.descriptor.segmentHash,
    predecessorSegmentHash: null,
    previousReceiptId: null,
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    evidenceProfileId: "standard-v1",
    sequenceFrom: 1,
    sequenceTo: 1,
    eventCount: 1,
    payloadBytes: command.descriptor.payloadBytes,
    acceptedAt: "2026-10-03T06:05:00.000Z",
  } as const;

  const signed: SignedEvidenceReceipt = {
    payload,
    payloadDigestSha256: "c".repeat(64),
    signature: {
      algorithm: "Ed25519",
      keyId: "kms-alias",
      keyVersion: "kms-arn",
      signatureEncoding: "raw",
      signatureBase64Url: "AQIDBA",
    },
  };

  return {
    command,
    record: {
      clientRequestId: "request-1",
      principalId: ACTOR,
      storageRef: `supabase://bucket/v2/${PACKAGE}/x.json`,
      descriptor: command.descriptor,
      receiptPayload: payload,
      status,
      signedReceipt: status === "signed" ? signed : null,
    },
    signed,
  };
}

function rpcClient(
  handler: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>,
): SupabaseClient {
  return { rpc: handler } as unknown as SupabaseClient;
}

describe("SupabaseEvidenceAcceptanceRepository", () => {
  it("parses a pending lookup and a signed duplicate strictly", async () => {
    const pending = await fixtureRecord("pending_signature");
    const pendingRepo = new SupabaseEvidenceAcceptanceRepository(
      rpcClient(async () => ({
        data: { status: "duplicate_pending", record: pending.record },
        error: null,
      })),
    );
    await expect(
      pendingRepo.lookup({
        principalId: ACTOR,
        evidencePackageId: PACKAGE,
        clientRequestId: "request-1",
        descriptor: pending.command.descriptor,
      }),
    ).resolves.toMatchObject({ status: "duplicate_pending" });

    const signed = await fixtureRecord("signed");
    const signedRepo = new SupabaseEvidenceAcceptanceRepository(
      rpcClient(async () => ({
        data: { status: "duplicate_signed", record: signed.record },
        error: null,
      })),
    );
    await expect(
      signedRepo.lookup({
        principalId: ACTOR,
        evidencePackageId: PACKAGE,
        clientRequestId: "request-1",
        descriptor: signed.command.descriptor,
      }),
    ).resolves.toMatchObject({ status: "duplicate_signed" });
  });

  it("maps chain and concurrency outcomes without inventing a successful record", async () => {
    const command = await buildEvidenceIngestCommandV2({
      evidencePackageId: PACKAGE,
      clientRequestId: "request-1",
      segment: segment(),
    });

    const chain = new SupabaseEvidenceAcceptanceRepository(
      rpcClient(async () => ({
        data: {
          status: "chain_conflict",
          expectedPreviousSegmentHash: A,
        },
        error: null,
      })),
    );
    await expect(
      chain.reserve({
        principalId: ACTOR,
        clientRequestId: "request-1",
        storageRef: "supabase://bucket/object",
        descriptor: command.descriptor,
      }),
    ).resolves.toEqual({
      status: "chain_conflict",
      expectedPreviousSegmentHash: A,
    });

    const concurrent = new SupabaseEvidenceAcceptanceRepository(
      rpcClient(async () => ({
        data: { status: "concurrent_conflict" },
        error: null,
      })),
    );
    await expect(
      concurrent.reserve({
        principalId: ACTOR,
        clientRequestId: "request-1",
        storageRef: "supabase://bucket/object",
        descriptor: command.descriptor,
      }),
    ).resolves.toEqual({ status: "concurrent_conflict" });
  });

  it("fails closed on malformed records and validates already-attached receipts", async () => {
    const malformed = new SupabaseEvidenceAcceptanceRepository(
      rpcClient(async () => ({
        data: {
          status: "duplicate_signed",
          record: { principalId: ACTOR },
        },
        error: null,
      })),
    );

    const command = await buildEvidenceIngestCommandV2({
      evidencePackageId: PACKAGE,
      clientRequestId: "request-1",
      segment: segment(),
    });
    await expect(
      malformed.lookup({
        principalId: ACTOR,
        evidencePackageId: PACKAGE,
        clientRequestId: "request-1",
        descriptor: command.descriptor,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });

    const signed = await fixtureRecord("signed");
    const attach = new SupabaseEvidenceAcceptanceRepository(
      rpcClient(async () => ({
        data: { status: "already_attached", receipt: signed.signed },
        error: null,
      })),
    );
    await expect(
      attach.attachSignature({
        receiptId: RECEIPT,
        signedReceipt: signed.signed,
      }),
    ).resolves.toEqual({
      status: "already_attached",
      receipt: signed.signed,
    });
  });
});
