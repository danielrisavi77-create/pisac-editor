import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type {
  EvidenceContextPort,
  EvidenceContextResolution,
} from "@/application/ports/evidence-trust";
import { SupabaseF1EvidenceAuthorizationPort } from "./supabase-f1-evidence-authorization";

class FakeContext implements EvidenceContextPort {
  result: EvidenceContextResolution = {
    status: "found",
    context: {
      evidencePackageId: "package-1",
      documentId: "doc-1",
      evidenceProfileId: "standard-v1",
      maxPayloadBytes: 1024,
      acceptsEvidence: true,
    },
  };

  async resolve(): Promise<EvidenceContextResolution> {
    return structuredClone(this.result);
  }
}

function userClient(result: {
  data: { id: string } | null;
  error: unknown;
}): SupabaseClient {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return result;
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("SupabaseF1EvidenceAuthorizationPort", () => {
  it("allows only the authenticated F1 owner for append_evidence", async () => {
    const contexts = new FakeContext();
    const port = new SupabaseF1EvidenceAuthorizationPort(
      userClient({ data: { id: "doc-1" }, error: null }),
      contexts,
      "user-1",
    );

    await expect(
      port.check({
        principalId: "user-1",
        action: "append_evidence",
        resource: { type: "evidence_package", id: "package-1" },
        consistency: "higher-consistency",
      }),
    ).resolves.toEqual({ status: "allow" });

    await expect(
      port.check({
        principalId: "other-user",
        action: "append_evidence",
        resource: { type: "evidence_package", id: "package-1" },
        consistency: "higher-consistency",
      }),
    ).resolves.toEqual({ status: "deny" });
  });

  it("does not become a general substitute for R2/OpenFGA", async () => {
    const port = new SupabaseF1EvidenceAuthorizationPort(
      userClient({ data: { id: "doc-1" }, error: null }),
      new FakeContext(),
      "user-1",
    );

    await expect(
      port.check({
        principalId: "user-1",
        action: "read_evidence",
        resource: { type: "evidence_package", id: "package-1" },
        consistency: "higher-consistency",
      }),
    ).resolves.toEqual({ status: "deny" });
  });

  it("fails closed on missing context, RLS denial or database failure", async () => {
    const missing = new FakeContext();
    missing.result = { status: "not_found" };
    const missingPort = new SupabaseF1EvidenceAuthorizationPort(
      userClient({ data: { id: "doc-1" }, error: null }),
      missing,
      "user-1",
    );
    await expect(
      missingPort.check({
        principalId: "user-1",
        action: "append_evidence",
        resource: { type: "evidence_package", id: "package-1" },
        consistency: "higher-consistency",
      }),
    ).resolves.toEqual({ status: "deny" });

    const deniedPort = new SupabaseF1EvidenceAuthorizationPort(
      userClient({ data: null, error: null }),
      new FakeContext(),
      "user-1",
    );
    await expect(
      deniedPort.check({
        principalId: "user-1",
        action: "append_evidence",
        resource: { type: "evidence_package", id: "package-1" },
        consistency: "higher-consistency",
      }),
    ).resolves.toEqual({ status: "deny" });

    const failedPort = new SupabaseF1EvidenceAuthorizationPort(
      userClient({ data: null, error: { message: "down" } }),
      new FakeContext(),
      "user-1",
    );
    await expect(
      failedPort.check({
        principalId: "user-1",
        action: "append_evidence",
        resource: { type: "evidence_package", id: "package-1" },
        consistency: "higher-consistency",
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "F1 evidence ownership check failed",
    });
  });
});
