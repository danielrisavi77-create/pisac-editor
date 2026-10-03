import type { AuthorizationContext } from "./authorization";
import type { SignedEvidenceReceipt } from "@/domain/forensics/evidence-receipt";
import {
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
} from "@/domain/forensics/evidence-segment-v2";

export type EvidenceSegmentDescriptorV2 = {
  evidencePackageId: string;
  documentId: string;
  sessionId: string;
  segmentId: string;
  evidenceSchema: typeof EVIDENCE_SEGMENT_SCHEMA_V2;
  canonicalization: typeof EVIDENCE_CANONICALIZATION_V2;
  hashAlgorithm: typeof EVIDENCE_HASH_ALGORITHM_V2;
  evidenceProfileId: string;
  sequenceFrom: number;
  sequenceTo: number;
  eventCount: number;
  observedStartedAt: string;
  observedEndedAt: string;
  segmentHash: string;
  predecessorSegmentHash: string | null;
  payloadBytes: number;
};

export type EvidenceIngestCommandV2 = {
  clientRequestId: string;
  descriptor: EvidenceSegmentDescriptorV2;
  /** Exact RFC 8785 JCS string whose SHA-256 is descriptor.segmentHash. */
  canonicalPayload: string;
};

export type EvidenceIngestRequestV2 = {
  principalId: string;
  command: EvidenceIngestCommandV2;
  authorizationContext?: AuthorizationContext;
};

export type EvidenceIngestOutcome =
  | { status: "accepted"; receipt: SignedEvidenceReceipt }
  | { status: "duplicate"; receipt: SignedEvidenceReceipt }
  | { status: "chain_conflict"; expectedPreviousSegmentHash: string | null }
  | { status: "idempotency_conflict" }
  | { status: "invalid" }
  | { status: "unauthorized" }
  | { status: "too_large" }
  | {
      status: "unavailable";
      stage: "authorization" | "context" | "storage" | "repository" | "signing";
      reason: string;
    };

export interface EvidenceIngestPort {
  ingest(request: EvidenceIngestRequestV2): Promise<EvidenceIngestOutcome>;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_ID_LENGTH = 256;
const MAX_CLIENT_REQUEST_ID_LENGTH = 256;

function nonEmptyBounded(value: unknown, max = MAX_ID_LENGTH): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max
  );
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function validateEvidenceIngestCommandV2(
  command: EvidenceIngestCommandV2,
): boolean {
  const descriptor = command?.descriptor;
  if (
    !descriptor ||
    !nonEmptyBounded(command.clientRequestId, MAX_CLIENT_REQUEST_ID_LENGTH) ||
    !nonEmptyBounded(command.canonicalPayload, 16 * 1024 * 1024) ||
    !nonEmptyBounded(descriptor.evidencePackageId) ||
    !nonEmptyBounded(descriptor.documentId) ||
    !nonEmptyBounded(descriptor.sessionId) ||
    !nonEmptyBounded(descriptor.segmentId) ||
    descriptor.evidenceSchema !== EVIDENCE_SEGMENT_SCHEMA_V2 ||
    descriptor.canonicalization !== EVIDENCE_CANONICALIZATION_V2 ||
    descriptor.hashAlgorithm !== EVIDENCE_HASH_ALGORITHM_V2 ||
    !nonEmptyBounded(descriptor.evidenceProfileId) ||
    !Number.isSafeInteger(descriptor.sequenceFrom) ||
    descriptor.sequenceFrom < 1 ||
    !Number.isSafeInteger(descriptor.sequenceTo) ||
    descriptor.sequenceTo < descriptor.sequenceFrom ||
    !Number.isSafeInteger(descriptor.eventCount) ||
    descriptor.eventCount < 1 ||
    descriptor.sequenceTo !== descriptor.sequenceFrom + descriptor.eventCount - 1 ||
    !canonicalInstant(descriptor.observedStartedAt) ||
    !canonicalInstant(descriptor.observedEndedAt) ||
    Date.parse(descriptor.observedEndedAt) <
      Date.parse(descriptor.observedStartedAt) ||
    !SHA256_HEX.test(descriptor.segmentHash) ||
    !(
      descriptor.predecessorSegmentHash === null ||
      SHA256_HEX.test(descriptor.predecessorSegmentHash)
    ) ||
    !Number.isSafeInteger(descriptor.payloadBytes) ||
    descriptor.payloadBytes < 1
  ) {
    return false;
  }

  return (
    new TextEncoder().encode(command.canonicalPayload).byteLength ===
    descriptor.payloadBytes
  );
}

export type { SignedEvidenceReceipt } from "@/domain/forensics/evidence-receipt";
