import {
  isEvidenceSegmentDescriptorV2,
  type EvidenceSegmentDescriptorV2,
} from "@/application/ports/evidence-ingest";
import type {
  EvidenceAcceptanceRecord,
  EvidencePackageContext,
} from "@/application/ports/evidence-trust";
import {
  isEvidenceReceiptPayloadV1,
  isSignedEvidenceReceipt,
} from "@/domain/forensics/evidence-receipt";
import { isPlainObject, ownProperty } from "@/domain/json";

function stringValue(value: unknown, max = 2048): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max
    ? value
    : null;
}

export function parseEvidencePackageContext(
  value: unknown,
): EvidencePackageContext | null {
  if (!isPlainObject(value)) return null;
  if (ownProperty(value, "status") !== "found") return null;

  const evidencePackageId = stringValue(ownProperty(value, "packageId"), 256);
  const documentId = stringValue(ownProperty(value, "documentId"), 256);
  const evidenceProfileId = stringValue(
    ownProperty(value, "evidenceProfileId"),
    120,
  );
  const maxPayloadBytes = ownProperty(value, "maxPayloadBytes");
  const acceptsEvidence = ownProperty(value, "acceptsEvidence");

  if (
    !evidencePackageId ||
    !documentId ||
    !evidenceProfileId ||
    !Number.isSafeInteger(maxPayloadBytes) ||
    Number(maxPayloadBytes) < 1 ||
    typeof acceptsEvidence !== "boolean"
  ) {
    return null;
  }

  return {
    evidencePackageId,
    documentId,
    evidenceProfileId,
    maxPayloadBytes: Number(maxPayloadBytes),
    acceptsEvidence,
  };
}

export function parseEvidenceAcceptanceRecord(
  value: unknown,
): EvidenceAcceptanceRecord | null {
  if (!isPlainObject(value)) return null;

  const clientRequestId = stringValue(ownProperty(value, "clientRequestId"), 256);
  const principalId = stringValue(ownProperty(value, "principalId"), 256);
  const storageRef = stringValue(ownProperty(value, "storageRef"), 1024);
  const descriptor = ownProperty(value, "descriptor");
  const receiptPayload = ownProperty(value, "receiptPayload");
  const status = ownProperty(value, "status");
  const signedReceipt = ownProperty(value, "signedReceipt");

  if (
    !clientRequestId ||
    !principalId ||
    !storageRef ||
    !isEvidenceSegmentDescriptorV2(descriptor) ||
    !isEvidenceReceiptPayloadV1(receiptPayload) ||
    (status !== "pending_signature" && status !== "signed")
  ) {
    return null;
  }

  if (status === "pending_signature") {
    if (signedReceipt !== null && signedReceipt !== undefined) return null;
    return {
      clientRequestId,
      principalId,
      storageRef,
      descriptor: descriptor as EvidenceSegmentDescriptorV2,
      receiptPayload,
      status,
    };
  }

  if (!isSignedEvidenceReceipt(signedReceipt)) return null;
  return {
    clientRequestId,
    principalId,
    storageRef,
    descriptor: descriptor as EvidenceSegmentDescriptorV2,
    receiptPayload,
    status,
    signedReceipt,
  };
}
