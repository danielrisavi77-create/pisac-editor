import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EvidenceContextPort,
  EvidenceContextResolution,
} from "@/application/ports/evidence-trust";
import { isPlainObject, ownProperty } from "@/domain/json";
import { parseEvidencePackageContext } from "./evidence-rpc-parsers";

export class SupabaseEvidenceContextPort implements EvidenceContextPort {
  constructor(private readonly supabase: SupabaseClient) {}

  async resolve(
    evidencePackageId: string,
  ): Promise<EvidenceContextResolution> {
    const { data, error } = await this.supabase.rpc(
      "pisac_evidence_get_package_context",
      { p_evidence_package_id: evidencePackageId },
    );

    if (error) {
      return {
        status: "unavailable",
        reason: "evidence context RPC unavailable",
      };
    }
    if (!isPlainObject(data)) {
      return {
        status: "unavailable",
        reason: "evidence context RPC returned invalid response",
      };
    }

    const status = ownProperty(data, "status");
    if (status === "not_found") return { status: "not_found" };
    if (status !== "found") {
      return {
        status: "unavailable",
        reason: "evidence context RPC returned unknown status",
      };
    }

    const context = parseEvidencePackageContext(data);
    return context
      ? { status: "found", context }
      : {
          status: "unavailable",
          reason: "evidence context payload invalid",
        };
  }
}
