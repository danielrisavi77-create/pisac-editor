import type { SignatureEnvelope } from "@/application/ports/signing-key-provider";
import { sha256WebCrypto } from "./crypto";
import { canonicalizeJcs } from "./jcs";
import type { EvidenceSegmentV2 } from "./evidence-segment-v2";

export const EVIDENCE_RECEIPT_SCHEMA_V1 = "pisac-evidence-receipt-v1" as const;

export type EvidenceReceiptPayloadV1 = {
  receiptSchema: typeof EVIDENCE_RECEIPT_SCHEMA_V1;
  receiptId: string;
  evidencePackageId: string;
  documentId: string;
  sessionId: string;
  segmentId: string;
  segmentHash: string;
  predecessorSegmentHash: string | null;
  previousReceiptId: string | null;
  evidenceSchema: EvidenceSegmentV2["evidenceSchema"];
  evidenceProfileId: string;
  sequenceFrom: number;
  sequenceTo: number;
  eventCount: number;
  payloadBytes: number;
  acceptedAt: string;
};

export type SignedEvidenceReceipt = {
  payload: EvidenceReceiptPayloadV1;
  payloadDigestSha256: string;
  signature: SignatureEnvelope;
};

export function canonicalEvidenceReceiptPayload(
  payload: EvidenceReceiptPayloadV1,
): string {
  return canonicalizeJcs(payload);
}

export async function digestEvidenceReceiptPayload(
  payload: EvidenceReceiptPayloadV1,
): Promise<{
  canonical: string;
  bytes: Uint8Array;
  sha256: string;
}> {
  const canonical = canonicalEvidenceReceiptPayload(payload);
  const bytes = new TextEncoder().encode(canonical);
  return {
    canonical,
    bytes,
    sha256: await sha256WebCrypto(canonical),
  };
}
