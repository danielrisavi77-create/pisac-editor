import type { SupabaseClient } from "@supabase/supabase-js";

import type { EvidencePackageContext } from "@/application/ports/evidence-trust";
import { isPlainObject, ownProperty } from "@/domain/json";

export type EnsureEvidencePackageResult =
  | { status: "ok"; context: EvidencePackageContext }
  | { status: "not_found" }
  | { status: "profile_conflict" }
  | { status: "invalid" }
  | { status: "unavailable" };

function parseOk(data: Record<string, unknown>): EvidencePackageContext | null {
  const packageId = ownProperty(data, "packageId");
  const documentId = ownProperty(data, "documentId");
  const profile = ownProperty(data, "evidenceProfileId");
  const max = ownProperty(data, "maxPayloadBytes");
  const accepts = ownProperty(data, "acceptsEvidence");

  if (
    typeof packageId !== "string" ||
    packageId.trim() === "" ||
    typeof documentId !== "string" ||
    documentId.trim() === "" ||
    typeof profile !== "string" ||
    profile.trim() === "" ||
    !Number.isSafeInteger(max) ||
    Number(max) < 1 ||
    typeof accepts !== "boolean"
  ) {
    return null;
  }

  return {
    evidencePackageId: packageId,
    documentId,
    evidenceProfileId: profile,
    maxPayloadBytes: Number(max),
    acceptsEvidence: accepts,
  };
}

export class SupabaseEvidencePackageProvisioner {
  constructor(private readonly supabase: SupabaseClient) {}

  async ensure(input: {
    actorId: string;
    documentId: string;
    evidenceProfileId: string;
    maxPayloadBytes: number;
  }): Promise<EnsureEvidencePackageResult> {
    const { data, error } = await this.supabase.rpc(
      "pisac_evidence_ensure_package",
      {
        p_actor_id: input.actorId,
        p_document_id: input.documentId,
        p_evidence_profile_id: input.evidenceProfileId,
        p_max_payload_bytes: input.maxPayloadBytes,
      },
    );

    if (error || !isPlainObject(data)) {
      return { status: "unavailable" };
    }

    const status = ownProperty(data, "status");
    if (status === "not_found") return { status: "not_found" };
    if (status === "profile_conflict") {
      return { status: "profile_conflict" };
    }
    if (status === "invalid") return { status: "invalid" };
    if (status !== "ok") return { status: "unavailable" };

    const context = parseOk(data);
    return context
      ? { status: "ok", context }
      : { status: "unavailable" };
  }
}
