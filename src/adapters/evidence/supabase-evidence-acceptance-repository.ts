import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isEvidenceSegmentDescriptorV2,
  type EvidenceSegmentDescriptorV2,
} from "@/application/ports/evidence-ingest";
import type {
  EvidenceAcceptanceIdentity,
  EvidenceAcceptanceRecord,
  EvidenceAcceptanceRepository,
  LookupEvidenceAcceptanceResult,
  ReserveEvidenceAcceptanceInput,
  ReserveEvidenceAcceptanceResult,
} from "@/application/ports/evidence-trust";
import {
  isEvidenceReceiptPayloadV1,
  isSignedEvidenceReceipt,
  type SignedEvidenceReceipt,
} from "@/domain/forensics/evidence-receipt";
import { isPlainObject } from "@/domain/json";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRecord(value: unknown): EvidenceAcceptanceRecord | null {
  if (!isPlainObject(value)) return null;

  const clientRequestId = value.clientRequestId;
  const principalId = value.principalId;
  const storageRef = value.storageRef;
  const descriptor = value.descriptor;
  const receiptPayload = value.receiptPayload;
  const status = value.status;
  const signedReceipt = value.signedReceipt;

  if (
    typeof clientRequestId !== "string" ||
    clientRequestId.trim().length === 0 ||
    clientRequestId.length > 256 ||
    typeof principalId !== "string" ||
    !UUID.test(principalId) ||
    typeof storageRef !== "string" ||
    storageRef.trim().length === 0 ||
    storageRef.length > 1024 ||
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
      descriptor,
      receiptPayload,
      status,
    };
  }

  if (!isSignedEvidenceReceipt(signedReceipt)) return null;
  return {
    clientRequestId,
    principalId,
    storageRef,
    descriptor,
    receiptPayload,
    status,
    signedReceipt,
  };
}

function parseDuplicate(
  status: "duplicate_pending" | "duplicate_signed",
  data: Record<string, unknown>,
): LookupEvidenceAcceptanceResult {
  const record = parseRecord(data.record);
  return record
    ? { status, record }
    : { status: "unavailable", reason: "invalid acceptance RPC record" };
}

function descriptorJson(
  descriptor: EvidenceSegmentDescriptorV2,
): EvidenceSegmentDescriptorV2 {
  return structuredClone(descriptor);
}

export class SupabaseEvidenceAcceptanceRepository
  implements EvidenceAcceptanceRepository
{
  constructor(private readonly supabaseAdmin: SupabaseClient) {}

  async lookup(
    input: EvidenceAcceptanceIdentity,
  ): Promise<LookupEvidenceAcceptanceResult> {
    const { data, error } = await this.supabaseAdmin.rpc(
      "pisac_evidence_lookup",
      {
        p_principal_id: input.principalId,
        p_evidence_package_id: input.evidencePackageId,
        p_client_request_id: input.clientRequestId,
        p_descriptor: descriptorJson(input.descriptor),
      },
    );

    if (error) {
      return { status: "unavailable", reason: "evidence lookup RPC failed" };
    }
    if (!isPlainObject(data) || typeof data.status !== "string") {
      return { status: "unavailable", reason: "invalid lookup RPC response" };
    }

    if (data.status === "not_found") return { status: "not_found" };
    if (data.status === "idempotency_conflict") {
      return { status: "idempotency_conflict" };
    }
    if (
      data.status === "duplicate_pending" ||
      data.status === "duplicate_signed"
    ) {
      return parseDuplicate(data.status, data);
    }

    return { status: "unavailable", reason: "unexpected lookup RPC status" };
  }

  async reserve(
    input: ReserveEvidenceAcceptanceInput,
  ): Promise<ReserveEvidenceAcceptanceResult> {
    const { data, error } = await this.supabaseAdmin.rpc(
      "pisac_evidence_reserve",
      {
        p_principal_id: input.principalId,
        p_client_request_id: input.clientRequestId,
        p_descriptor: descriptorJson(input.descriptor),
        p_storage_ref: input.storageRef,
      },
    );

    if (error) {
      return { status: "unavailable", reason: "evidence reserve RPC failed" };
    }
    if (!isPlainObject(data) || typeof data.status !== "string") {
      return { status: "unavailable", reason: "invalid reserve RPC response" };
    }

    if (
      data.status === "reserved" ||
      data.status === "duplicate_pending" ||
      data.status === "duplicate_signed"
    ) {
      const record = parseRecord(data.record);
      return record
        ? { status: data.status, record }
        : { status: "unavailable", reason: "invalid reserve RPC record" };
    }

    if (data.status === "chain_conflict") {
      const expected = data.expectedPreviousSegmentHash;
      if (
        expected === null ||
        (typeof expected === "string" && /^[0-9a-f]{64}$/.test(expected))
      ) {
        return {
          status: "chain_conflict",
          expectedPreviousSegmentHash: expected,
        };
      }
      return { status: "unavailable", reason: "invalid chain conflict response" };
    }

    if (
      data.status === "idempotency_conflict" ||
      data.status === "invalid" ||
      data.status === "unauthorized" ||
      data.status === "not_accepting" ||
      data.status === "too_large" ||
      data.status === "context_mismatch" ||
      data.status === "concurrent_conflict"
    ) {
      return { status: data.status };
    }

    return { status: "unavailable", reason: "unexpected reserve RPC status" };
  }

  async attachSignature(input: {
    receiptId: string;
    signedReceipt: SignedEvidenceReceipt;
  }): ReturnType<EvidenceAcceptanceRepository["attachSignature"]> {
    const { data, error } = await this.supabaseAdmin.rpc(
      "pisac_evidence_attach_signature",
      {
        p_receipt_id: input.receiptId,
        p_signed_receipt: structuredClone(input.signedReceipt),
      },
    );

    if (error) {
      return {
        status: "unavailable",
        reason: "evidence signature RPC failed",
      };
    }
    if (!isPlainObject(data) || typeof data.status !== "string") {
      return {
        status: "unavailable",
        reason: "invalid signature RPC response",
      };
    }

    if (data.status === "attached") return { status: "attached" };
    if (data.status === "not_found") return { status: "not_found" };
    if (data.status === "conflict") return { status: "conflict" };
    if (data.status === "already_attached") {
      return isSignedEvidenceReceipt(data.receipt)
        ? { status: "already_attached", receipt: data.receipt }
        : {
            status: "unavailable",
            reason: "invalid existing signed receipt",
          };
    }

    return {
      status: "unavailable",
      reason: "unexpected signature RPC status",
    };
  }
}
