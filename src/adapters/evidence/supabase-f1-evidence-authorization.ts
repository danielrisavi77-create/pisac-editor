import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuthorizationDecision,
  AuthorizationPort,
  AuthorizationCheck,
} from "@/application/ports/authorization";
import type { EvidenceContextPort } from "@/application/ports/evidence-trust";

/**
 * Temporary F1 shadow bridge.
 *
 * Target institutional authorization is OpenFGA/ReBAC (R2). Until that runtime
 * adapter is deployed, this bridge allows only APPEND_EVIDENCE and proves the
 * authenticated principal currently owns the package's document through the
 * existing user-scoped pisac_documents RLS policy.
 *
 * The production reserve RPC independently checks the same F1 ownership again.
 */
export class SupabaseF1EvidenceAuthorizationPort
  implements AuthorizationPort
{
  constructor(
    private readonly userSupabase: SupabaseClient,
    private readonly contexts: EvidenceContextPort,
    private readonly authenticatedUserId: string,
  ) {}

  async check(request: AuthorizationCheck): Promise<AuthorizationDecision> {
    if (
      request.action !== "append_evidence" ||
      request.resource.type !== "evidence_package" ||
      request.principalId !== this.authenticatedUserId
    ) {
      return { status: "deny" };
    }

    const resolved = await this.contexts.resolve(request.resource.id);
    if (resolved.status === "unavailable") {
      return { status: "unavailable", reason: resolved.reason };
    }
    if (resolved.status === "not_found") {
      return { status: "deny" };
    }

    const { data, error } = await this.userSupabase
      .from("pisac_documents")
      .select("id")
      .eq("id", resolved.context.documentId)
      .maybeSingle();

    if (error) {
      return {
        status: "unavailable",
        reason: "F1 evidence ownership check failed",
      };
    }

    return data?.id === resolved.context.documentId
      ? { status: "allow" }
      : { status: "deny" };
  }
}
