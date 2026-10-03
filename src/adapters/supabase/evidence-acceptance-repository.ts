import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EvidenceAcceptanceIdentity,
  EvidenceAcceptanceRepository,
  LookupEvidenceAcceptanceResult,
  ReserveEvidenceAcceptanceInput,
  ReserveEvidenceAcceptanceResult,
} from "@/application/ports/evidence-trust";
import {
  isSignedEvidenceReceipt,
  type SignedEvidenceReceipt,
} from "@/domain/forensics/evidence-receipt";
import { isPlainObject, ownProperty } from "@/domain/json";
import { parseEvidenceAcceptanceRecord } from "./evidence-rpc-parsers";

function parseDuplicateRecord(
  data: Record<string, unknown>,
):
  | { ok: true; status: "duplicate_pending" | "duplicate_signed"; record: NonNullable<ReturnType<typeof parseEvidenceAcceptanceRecord>> }
  | { ok: false } {
  const status = ownProperty(data, "status");
  if (status !== "duplicate_pending" && status !== "duplicate_signed") {
    return { ok: false };
  }
  const record = parseEvidenceAcceptanceRecord(ownProperty(data, "record"));
  return record ? { ok: true, status, record } : { ok: false };
}

export class SupabaseEvidenceAcceptanceRepository
  implements EvidenceAcceptanceRepository
{
  constructor(private readonly supabase: SupabaseClient) {}

  async lookup(
    input: EvidenceAcceptanceIdentity,
  ): Promise<LookupEvidenceAcceptanceResult> {
    const { data, error } = await this.supabase.rpc(
      "pisac_evidence_lookup",
      {
        p_principal_id: input.principalId,
        p_evidence_package_id: input.evidencePackageId,
        p_client_request_id: input.clientRequestId,
        p_descriptor: input.descriptor,
      },
    );

    if (error) {
      return {
        status: "unavailable",
        reason: "evidence lookup RPC unavailable",
      };
    }
    if (!isPlainObject(data)) {
      return {
        status: "unavailable",
        reason: "evidence lookup RPC returned invalid response",
      };
    }

    const status = ownProperty(data, "status");
    if (status === "not_found") return { status: "not_found" };
    if (status === "idempotency_conflict") {
      return { status: "idempotency_conflict" };
    }
    if (status === "invalid") {
      return {
        status: "unavailable",
        reason: "evidence lookup RPC rejected adapter input",
      };
    }

    const duplicate = parseDuplicateRecord(data);
    if (!duplicate.ok) {
      return {
        status: "unavailable",
        reason: "evidence lookup RPC returned unknown response",
      };
    }
    return {
      status: duplicate.status,
      record: duplicate.record,
    };
  }

  async reserve(
    input: ReserveEvidenceAcceptanceInput,
  ): Promise<ReserveEvidenceAcceptanceResult> {
    const { data, error } = await this.supabase.rpc(
      "pisac_evidence_reserve",
      {
        p_principal_id: input.principalId,
        p_client_request_id: input.clientRequestId,
        p_descriptor: input.descriptor,
        p_storage_ref: input.storageRef,
      },
    );

    if (error) {
      return {
        status: "unavailable",
        reason: "evidence reserve RPC unavailable",
      };
    }
    if (!isPlainObject(data)) {
      return {
        status: "unavailable",
        reason: "evidence reserve RPC returned invalid response",
      };
    }

    const status = ownProperty(data, "status");

    if (
      status === "idempotency_conflict" ||
      status === "invalid" ||
      status === "unauthorized" ||
      status === "not_accepting" ||
      status === "too_large" ||
      status === "context_mismatch" ||
      status === "concurrent_conflict"
    ) {
      return { status };
    }

    if (status === "not_found") {
      return {
        status: "unavailable",
        reason: "evidence package disappeared during reserve",
      };
    }

    if (status === "chain_conflict") {
      const expected = ownProperty(data, "expectedPreviousSegmentHash");
      if (
        expected !== null &&
        !(typeof expected === "string" && /^[0-9a-f]{64}$/.test(expected))
      ) {
        return {
          status: "unavailable",
          reason: "evidence chain conflict payload invalid",
        };
      }
      return {
        status: "chain_conflict",
        expectedPreviousSegmentHash: expected as string | null,
      };
    }

    if (status === "reserved") {
      const record = parseEvidenceAcceptanceRecord(
        ownProperty(data, "record"),
      );
      return record
        ? { status: "reserved", record }
        : {
            status: "unavailable",
            reason: "evidence reserve record invalid",
          };
    }

    const duplicate = parseDuplicateRecord(data);
    if (duplicate.ok) {
      return {
        status: duplicate.status,
        record: duplicate.record,
      };
    }

    return {
      status: "unavailable",
      reason: "evidence reserve RPC returned unknown response",
    };
  }

  async attachSignature(input: {
    receiptId: string;
    signedReceipt: SignedEvidenceReceipt;
  }): Promise<
    | { status: "attached" }
    | { status: "already_attached"; receipt: SignedEvidenceReceipt }
    | { status: "conflict" }
    | { status: "not_found" }
    | { status: "unavailable"; reason: string }
  > {
    const { data, error } = await this.supabase.rpc(
      "pisac_evidence_attach_signature",
      {
        p_receipt_id: input.receiptId,
        p_signed_receipt: input.signedReceipt,
      },
    );

    if (error) {
      return {
        status: "unavailable",
        reason: "evidence signature RPC unavailable",
      };
    }
    if (!isPlainObject(data)) {
      return {
        status: "unavailable",
        reason: "evidence signature RPC returned invalid response",
      };
    }

    const status = ownProperty(data, "status");
    if (
      status === "attached" ||
      status === "conflict" ||
      status === "not_found"
    ) {
      return { status };
    }

    if (status === "already_attached") {
      const receipt = ownProperty(data, "receipt");
      return isSignedEvidenceReceipt(receipt)
        ? { status: "already_attached", receipt }
        : {
            status: "unavailable",
            reason: "stored signed receipt is invalid",
          };
    }

    return {
      status: "unavailable",
      reason: "evidence signature RPC returned unknown status",
    };
  }
}
