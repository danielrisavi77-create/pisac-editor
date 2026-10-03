import { NextResponse } from "next/server";

import { SupabaseEvidenceAcceptanceRepository } from "@/adapters/evidence/supabase-evidence-acceptance-repository";
import { SupabaseEvidenceContextPort } from "@/adapters/evidence/supabase-evidence-context";
import { SupabaseF1EvidenceAuthorizationPort } from "@/adapters/evidence/supabase-f1-evidence-authorization";
import {
  SupabaseEvidencePayloadStore,
  verifySupabaseEvidenceBucket,
} from "@/adapters/evidence/supabase-evidence-payload-store";
import { EvidenceGateway } from "@/application/evidence/evidence-gateway";
import { isEvidenceIngestCommandV2 } from "@/application/ports/evidence-ingest";
import { readJsonBodyLimited } from "@/lib/evidence/shadow-http";
import { getEvidenceShadowConfig } from "@/lib/evidence/shadow-config";
import { createEvidenceShadowSigner } from "@/lib/evidence/shadow-signer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const configResult = getEvidenceShadowConfig();
  if (!configResult.ok) {
    return json({ status: "unavailable", reason: configResult.reason }, 503);
  }
  const config = configResult.value;
  if (!config.enabled) {
    return json({ status: "not_found" }, 404);
  }

  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return json({ status: "invalid", reason: "JSON required" }, 415);
  }

  const userSupabase = await createClient();
  if (!userSupabase) {
    return json({ status: "unavailable", reason: "Supabase not configured" }, 503);
  }
  const {
    data: { user },
    error: userError,
  } = await userSupabase.auth.getUser();
  if (userError || !user) {
    return json({ status: "unauthenticated" }, 401);
  }

  const supabaseAdmin = createAdminClient();
  if (!supabaseAdmin) {
    return json({ status: "unavailable", reason: "server secret not configured" }, 503);
  }

  const bucket = await verifySupabaseEvidenceBucket(
    supabaseAdmin,
    config.bucket,
  );
  if (bucket.status !== "ready") {
    return json(
      {
        status: "unavailable",
        reason:
          bucket.status === "misconfigured"
            ? bucket.reason
            : `Evidence bucket is ${bucket.status}`,
      },
      503,
    );
  }

  const signerResult = createEvidenceShadowSigner(config);
  if (signerResult.status !== "ready") {
    return json(
      { status: "unavailable", reason: signerResult.reason },
      503,
    );
  }

  const parsed = await readJsonBodyLimited(request, config.maxCommandBytes);
  if (!parsed.ok) {
    return json({ status: "invalid", reason: parsed.reason }, parsed.status);
  }
  if (!isEvidenceIngestCommandV2(parsed.value)) {
    return json({ status: "invalid" }, 400);
  }

  const contexts = new SupabaseEvidenceContextPort(supabaseAdmin);
  const authorization = new SupabaseF1EvidenceAuthorizationPort(
    userSupabase,
    contexts,
    user.id,
  );
  const gateway = new EvidenceGateway({
    authorization,
    contexts,
    payloadStore: new SupabaseEvidencePayloadStore(
      supabaseAdmin,
      config.bucket,
    ),
    repository: new SupabaseEvidenceAcceptanceRepository(supabaseAdmin),
    signer: signerResult.signer,
  });

  const outcome = await gateway.ingest({
    principalId: user.id,
    command: parsed.value,
  });

  if (outcome.status === "accepted") {
    return json(outcome, 201);
  }
  if (outcome.status === "duplicate") {
    return json(outcome, 200);
  }
  if (outcome.status === "invalid") {
    return json(outcome, 400);
  }
  if (outcome.status === "unauthorized") {
    return json(outcome, 403);
  }
  if (outcome.status === "too_large") {
    return json(outcome, 413);
  }
  if (
    outcome.status === "chain_conflict" ||
    outcome.status === "idempotency_conflict" ||
    outcome.status === "not_accepting"
  ) {
    return json(outcome, 409);
  }
  return json(outcome, 503);
}
