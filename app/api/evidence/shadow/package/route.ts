import { NextResponse } from "next/server";

import { ensureSupabaseEvidencePackage } from "@/adapters/evidence/supabase-evidence-context";
import { verifySupabaseEvidenceBucket } from "@/adapters/evidence/supabase-evidence-payload-store";
import { readJsonBodyLimited } from "@/lib/evidence/shadow-http";
import { getEvidenceShadowConfig } from "@/lib/evidence/shadow-config";
import { createEvidenceShadowSigner } from "@/lib/evidence/shadow-signer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isPlainObject } from "@/domain/json";

export const runtime = "nodejs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  // Do not create even a shadow package until the complete signing path is
  // ready. Production aws-kms mode intentionally stays unavailable until the
  // official SDK transport is composed.
  const signer = createEvidenceShadowSigner(config);
  if (signer.status !== "ready") {
    return json({ status: "unavailable", reason: signer.reason }, 503);
  }

  const parsed = await readJsonBodyLimited(request, 8 * 1024);
  if (!parsed.ok) {
    return json({ status: "invalid", reason: parsed.reason }, parsed.status);
  }
  if (
    !isPlainObject(parsed.value) ||
    typeof parsed.value.documentId !== "string" ||
    !UUID.test(parsed.value.documentId)
  ) {
    return json({ status: "invalid", reason: "invalid document id" }, 400);
  }

  const ensured = await ensureSupabaseEvidencePackage(supabaseAdmin, {
    actorId: user.id,
    documentId: parsed.value.documentId,
    evidenceProfileId: config.evidenceProfileId,
    maxPayloadBytes: config.maxPayloadBytes,
  });

  if (ensured.status === "ok") {
    return json({ status: "ok", context: ensured.context }, 200);
  }
  if (ensured.status === "not_found") {
    return json({ status: "not_found" }, 404);
  }
  if (ensured.status === "profile_conflict") {
    return json(
      {
        status: "profile_conflict",
        evidencePackageId: ensured.evidencePackageId,
        maxPayloadBytes: ensured.maxPayloadBytes,
      },
      409,
    );
  }
  if (ensured.status === "invalid") {
    return json({ status: "invalid" }, 400);
  }
  return json({ status: "unavailable", reason: ensured.reason }, 503);
}
