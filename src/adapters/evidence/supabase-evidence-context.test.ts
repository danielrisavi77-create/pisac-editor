import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  ensureSupabaseEvidencePackage,
  SupabaseEvidenceContextPort,
} from "./supabase-evidence-context";

const PACKAGE = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";

function client(
  handler: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>,
): SupabaseClient {
  return {
    rpc: handler,
  } as unknown as SupabaseClient;
}

describe("Supabase evidence context adapter", () => {
  it("strictly parses a found EvidencePackage context", async () => {
    const supabase = client(async () => ({
      data: {
        status: "found",
        packageId: PACKAGE,
        documentId: DOCUMENT,
        evidenceProfileId: "standard-v1",
        maxPayloadBytes: 2097152,
        acceptsEvidence: true,
      },
      error: null,
    }));

    await expect(
      new SupabaseEvidenceContextPort(supabase).resolve(PACKAGE),
    ).resolves.toEqual({
      status: "found",
      context: {
        evidencePackageId: PACKAGE,
        documentId: DOCUMENT,
        evidenceProfileId: "standard-v1",
        maxPayloadBytes: 2097152,
        acceptsEvidence: true,
      },
    });
  });

  it("fails closed on malformed RPC output or provider error", async () => {
    const malformed = client(async () => ({
      data: {
        status: "found",
        packageId: PACKAGE,
        documentId: "not-a-uuid",
        evidenceProfileId: "standard-v1",
        maxPayloadBytes: 2097152,
        acceptsEvidence: true,
      },
      error: null,
    }));
    await expect(
      new SupabaseEvidenceContextPort(malformed).resolve(PACKAGE),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "invalid context RPC response",
    });

    const down = client(async () => ({
      data: null,
      error: { message: "down" },
    }));
    await expect(
      new SupabaseEvidenceContextPort(down).resolve(PACKAGE),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "evidence context RPC failed",
    });
  });

  it("creates or reuses a package only through the service RPC", async () => {
    let seenFn = "";
    let seenArgs: Record<string, unknown> = {};
    const supabase = client(async (fn, args) => {
      seenFn = fn;
      seenArgs = args;
      return {
        data: {
          status: "ok",
          packageId: PACKAGE,
          documentId: DOCUMENT,
          evidenceProfileId: "standard-v1",
          maxPayloadBytes: 2097152,
          acceptsEvidence: true,
        },
        error: null,
      };
    });

    await expect(
      ensureSupabaseEvidencePackage(supabase, {
        actorId: ACTOR,
        documentId: DOCUMENT,
        evidenceProfileId: "standard-v1",
        maxPayloadBytes: 2097152,
      }),
    ).resolves.toMatchObject({ status: "ok" });

    expect(seenFn).toBe("pisac_evidence_ensure_package");
    expect(seenArgs).toEqual({
      p_actor_id: ACTOR,
      p_document_id: DOCUMENT,
      p_evidence_profile_id: "standard-v1",
      p_max_payload_bytes: 2097152,
    });
  });
});
