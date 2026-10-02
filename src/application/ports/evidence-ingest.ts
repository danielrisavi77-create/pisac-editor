/**
 * Server anchoring contract for locally verified process segments.
 *
 * A server receipt proves only that Pisač accepted a specific segment hash
 * from an authenticated principal at a server-observed time. It is NOT proof
 * that a human physically pressed keys, that the principal personally authored
 * the text, or that external AI/tools were absent.
 */

export type EvidenceSegmentDescriptor = {
  documentId: string;
  sessionId: string;
  segmentId: string;
  schema: string;
  eventCount: number;
  startedAt: string;
  endedAt: string;
  segmentHash: string;
  previousSegmentHash: string | null;
  payloadBytes: number;
};

export type EvidenceIngestCommand = {
  clientRequestId: string;
  descriptor: EvidenceSegmentDescriptor;
  /** Canonical serialized segment bytes whose hash is descriptor.segmentHash. */
  canonicalPayload: string;
};

export type ServerEvidenceReceipt = {
  receiptId: string;
  principalId: string;
  documentId: string;
  sessionId: string;
  segmentId: string;
  acceptedAt: string;
  segmentHash: string;
  previousReceiptId: string | null;
  storageRef: string;
};

export type EvidenceIngestOutcome =
  | { status: "accepted"; receipt: ServerEvidenceReceipt }
  | { status: "duplicate"; receipt: ServerEvidenceReceipt }
  | { status: "chain_conflict"; expectedPreviousSegmentHash: string | null }
  | { status: "invalid" }
  | { status: "unauthorized" }
  | { status: "too_large" };

export interface EvidenceIngestPort {
  ingest(command: EvidenceIngestCommand): Promise<EvidenceIngestOutcome>;
}

function nonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateEvidenceIngestCommand(command: EvidenceIngestCommand): boolean {
  const d = command?.descriptor;
  if (
    !d ||
    !nonEmpty(command.clientRequestId) ||
    !nonEmpty(command.canonicalPayload) ||
    !nonEmpty(d.documentId) ||
    !nonEmpty(d.sessionId) ||
    !nonEmpty(d.segmentId) ||
    !nonEmpty(d.schema) ||
    !nonEmpty(d.segmentHash) ||
    (d.previousSegmentHash !== null && !nonEmpty(d.previousSegmentHash)) ||
    !Number.isSafeInteger(d.eventCount) ||
    d.eventCount < 0 ||
    !Number.isSafeInteger(d.payloadBytes) ||
    d.payloadBytes < 1 ||
    !Number.isFinite(Date.parse(d.startedAt)) ||
    !Number.isFinite(Date.parse(d.endedAt)) ||
    Date.parse(d.endedAt) < Date.parse(d.startedAt)
  ) {
    return false;
  }
  return new TextEncoder().encode(command.canonicalPayload).byteLength === d.payloadBytes;
}
