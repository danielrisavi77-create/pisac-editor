import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AuthorizationCheck,
  AuthorizationDecision,
  AuthorizationPort,
} from "@/application/ports/authorization";
import { isPlainObject } from "@/domain/json";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * F1 shadow-only owner authorization.
 *
 * This is intentionally narrower than the R2 OpenFGA target. It exists only
 * so the R4 shadow path can prove production persistence without introducing
 * a second unreviewed relationship model.
 */
export class SupabaseShadowEvidenceAuthorizationPort
  implements AuthorizationPort
{
  constructor(private readonly supabaseAdmin: SupabaseClient) {}

  async check(
    request: AuthorizationCheck,
  ): Promise<AuthorizationDecision> {
    if (
      request.action !== "append_evidence" ||
      request.resource.type !== "evidence_package" ||
      request.consistency !== "higher-consistency" ||
      !UUID.test(request.principalId) ||
      !UUID.test(request.resource.id)
    ) {
      return { status: "deny" };
    }

    const { data, error } = await this.supabaseAdmin.rpc(
      "pisac_evidence_authorize_append",
      {
        p_principal_id: request.principalId,
        p_evidence_package_id: request.resource.id,
      },
    );

    if (error) {
      return {
        status: "unavailable",
        reason: "shadow authorization RPC failed",
      };
    }
    if (!isPlainObject(data) || typeof data.status !== "string") {
      return {
        status: "unavailable",
        reason: "invalid shadow authorization response",
      };
    }

    if (data.status === "allow") return { status: "allow" };
    if (data.status === "deny") return { status: "deny" };
    return {
      status: "unavailable",
      reason: "unexpected shadow authorization status",
    };
  }
}
