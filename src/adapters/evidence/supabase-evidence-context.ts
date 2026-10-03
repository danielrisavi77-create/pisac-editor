import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EvidenceContextPort,
  EvidenceContextResolution,
  EvidencePackageContext,
} from "@/application/ports/evidence-trust";
import { isPlainObject } from "@/domain/json";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePackageContext(value: unknown): EvidencePackageContext | null {
  if (!isPlainObject(value)) return null;

  const evidencePackageId = value.packageId;
  const documentId = value.documentId;
  const evidenceProfileId = value.evidenceProfileId;
  const maxPayloadBytes = value.maxPayloadBytes;
  const acceptsEvidence = value.acceptsEvidence;

  if (
    typeof evidencePackageId !== "string" ||
    !UUID.test(evidencePackageId) ||
    typeof documentId !== "string" ||
    !UUID.test(documentId) ||
    typeof evidenceProfileId !== "string" ||
    evidenceProfileId.trim().length === 0 ||
    evidenceProfileId.length > 120 ||
    typeof maxPayloadBytes !== "number" ||
    !Number.isSafeInteger(maxPayloadBytes) ||
    maxPayloadBytes < 1 ||
    maxPayloadBytes > 16 * 1024 * 1024 ||
    typeof acceptsEvidence !== "boolean"
  ) {
    return null;
  }

  return {
    evidencePackageId,
    documentId,
    evidenceProfileId,
    maxPayloadBytes,
    acceptsEvidence,
  };
}

export type EnsureEvidencePackageResult =
  | { status: "ok"; context: EvidencePackageContext }
  | {
      status: "profile_conflict";
      evidencePackageId: string;
      maxPayloadBytes: number;
    }
  | { status: "not_found" }
  | { status: "invalid" }
  | { status: "unavailable"; reason: string };

export async function ensureSupabaseEvidencePackage(
  supabaseAdmin: SupabaseClient,
  input: {
    actorId: string;
    documentId: string;
    evidenceProfileId: string;
    maxPayloadBytes: number;
  },
): Promise<EnsureEvidencePackageResult> {
  if (
    !UUID.test(input.actorId) ||
    !UUID.test(input.documentId) ||
    input.evidenceProfileId.trim().length === 0 ||
    input.evidenceProfileId.length > 120 ||
    !Number.isSafeInteger(input.maxPayloadBytes) ||
    input.maxPayloadBytes < 1 ||
    input.maxPayloadBytes > 16 * 1024 * 1024
  ) {
    return { status: "invalid" };
  }

  const { data, error } = await supabaseAdmin.rpc(
    "pisac_evidence_ensure_package",
    {
      p_actor_id: input.actorId,
      p_document_id: input.documentId,
      p_evidence_profile_id: input.evidenceProfileId,
      p_max_payload_bytes: input.maxPayloadBytes,
    },
  );

  if (error) {
    return { status: "unavailable", reason: "evidence package RPC failed" };
  }
  if (!isPlainObject(data) || typeof data.status !== "string") {
    return { status: "unavailable", reason: "invalid package RPC response" };
  }

  if (data.status === "ok") {
    const context = parsePackageContext(data);
    return context
      ? { status: "ok", context }
      : { status: "unavailable", reason: "invalid package RPC response" };
  }

  if (data.status === "profile_conflict") {
    if (
      typeof data.packageId === "string" &&
      UUID.test(data.packageId) &&
      typeof data.maxPayloadBytes === "number" &&
      Number.isSafeInteger(data.maxPayloadBytes)
    ) {
      return {
        status: "profile_conflict",
        evidencePackageId: data.packageId,
        maxPayloadBytes: data.maxPayloadBytes,
      };
    }
    return { status: "unavailable", reason: "invalid package RPC response" };
  }

  if (data.status === "not_found") return { status: "not_found" };
  if (data.status === "invalid") return { status: "invalid" };

  return { status: "unavailable", reason: "unexpected package RPC status" };
}

export class SupabaseEvidenceContextPort implements EvidenceContextPort {
  constructor(private readonly supabaseAdmin: SupabaseClient) {}

  async resolve(
    evidencePackageId: string,
  ): Promise<EvidenceContextResolution> {
    if (!UUID.test(evidencePackageId)) return { status: "not_found" };

    const { data, error } = await this.supabaseAdmin.rpc(
      "pisac_evidence_get_package_context",
      { p_evidence_package_id: evidencePackageId },
    );

    if (error) {
      return { status: "unavailable", reason: "evidence context RPC failed" };
    }
    if (!isPlainObject(data) || typeof data.status !== "string") {
      return { status: "unavailable", reason: "invalid context RPC response" };
    }
    if (data.status === "not_found") return { status: "not_found" };
    if (data.status !== "found") {
      return { status: "unavailable", reason: "unexpected context RPC status" };
    }

    const context = parsePackageContext(data);
    return context
      ? { status: "found", context }
      : { status: "unavailable", reason: "invalid context RPC response" };
  }
}
