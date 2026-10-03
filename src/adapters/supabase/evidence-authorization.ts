import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuthorizationCheck,
  AuthorizationDecision,
  AuthorizationPort,
} from "@/application/ports/authorization";
import { isPlainObject, ownProperty } from "@/domain/json";

/**
 * Shadow F1 authorization adapter.
 *
 * It deliberately supports only append_evidence and delegates to the
 * service-role-only owner check in Postgres. This is NOT the vNext target
 * authorization system; OpenFGA from R2 replaces it before multi-mentor or
 * institutional rollout.
 */
export class SupabaseShadowEvidenceAuthorizationPort
  implements AuthorizationPort
{
  constructor(private readonly supabase: SupabaseClient) {}

  async check(
    request: AuthorizationCheck,
  ): Promise<AuthorizationDecision> {
    if (
      request.action !== "append_evidence" ||
      request.resource.type !== "evidence_package" ||
      request.consistency !== "higher-consistency"
    ) {
      return { status: "deny" };
    }

    const { data, error } = await this.supabase.rpc(
      "pisac_evidence_authorize_append",
      {
        p_principal_id: request.principalId,
        p_evidence_package_id: request.resource.id,
      },
    );

    if (error) {
      return {
        status: "unavailable",
        reason: "shadow evidence authorization unavailable",
      };
    }
    if (!isPlainObject(data)) {
      return {
        status: "unavailable",
        reason: "shadow evidence authorization response invalid",
      };
    }

    const status = ownProperty(data, "status");
    if (status === "allow") return { status: "allow" };
    if (status === "deny") return { status: "deny" };
    return {
      status: "unavailable",
      reason: "shadow evidence authorization status invalid",
    };
  }
}
