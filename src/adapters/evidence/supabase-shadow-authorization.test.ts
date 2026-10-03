import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { SupabaseShadowEvidenceAuthorizationPort } from "./supabase-shadow-authorization";

const USER = "11111111-1111-4111-8111-111111111111";
const PACKAGE = "22222222-2222-4222-8222-222222222222";

function client(result: {
  data: unknown;
  error: unknown;
}): SupabaseClient {
  return {
    rpc: async () => result,
  } as unknown as SupabaseClient;
}

describe("SupabaseShadowEvidenceAuthorizationPort", () => {
  it("allows only the R4 append_evidence higher-consistency check", async () => {
    const port = new SupabaseShadowEvidenceAuthorizationPort(
      client({ data: { status: "allow" }, error: null }),
    );

    await expect(
      port.check({
        principalId: USER,
        action: "append_evidence",
        resource: { type: "evidence_package", id: PACKAGE },
        consistency: "higher-consistency",
      }),
    ).resolves.toEqual({ status: "allow" });

    await expect(
      port.check({
        principalId: USER,
        action: "read_evidence",
        resource: { type: "evidence_package", id: PACKAGE },
        consistency: "higher-consistency",
      }),
    ).resolves.toEqual({ status: "deny" });

    await expect(
      port.check({
        principalId: USER,
        action: "append_evidence",
        resource: { type: "evidence_package", id: PACKAGE },
        consistency: "minimize-latency",
      }),
    ).resolves.toEqual({ status: "deny" });
  });

  it("fails closed on RPC error or malformed response", async () => {
    await expect(
      new SupabaseShadowEvidenceAuthorizationPort(
        client({ data: null, error: { message: "down" } }),
      ).check({
        principalId: USER,
        action: "append_evidence",
        resource: { type: "evidence_package", id: PACKAGE },
        consistency: "higher-consistency",
      }),
    ).resolves.toMatchObject({ status: "unavailable" });

    await expect(
      new SupabaseShadowEvidenceAuthorizationPort(
        client({ data: { status: "mystery" }, error: null }),
      ).check({
        principalId: USER,
        action: "append_evidence",
        resource: { type: "evidence_package", id: PACKAGE },
        consistency: "higher-consistency",
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
  });
});
