import { NextResponse } from "next/server";

import { isPlainObject, ownProperty } from "@/domain/json";
import { getEvidenceShadowConfig } from "@/lib/evidence/shadow-config";
import {
  isPinnedSameOrigin,
  readJsonBodyLimited,
} from "@/lib/evidence/shadow-http";
import { createEvidenceShadowRuntime } from "@/lib/evidence/shadow-runtime";
import { getEvidenceShadowSession } from "@/lib/evidence/shadow-session";

export const runtime = "nodejs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const config = getEvidenceShadowConfig();
  if (config.status === "disabled") return json({ status: "disabled" }, 404);
  if (config.status !== "ready") {
    return json({ status: "unavailable" }, 503);
  }
  if (!isPinnedSameOrigin(request, config.value.siteOrigin)) {
    return json({ status: "forbidden" }, 403);
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return json({ status: "invalid" }, 415);
  }

  const session = await getEvidenceShadowSession();
  if (session.status === "unconfigured") {
    return json({ status: "unavailable" }, 503);
  }
  if (session.status === "unauthenticated") {
    return json({ status: "unauthenticated" }, 401);
  }

  const body = await readJsonBodyLimited(request, 4096);
  if (!body.ok || !isPlainObject(body.value)) {
    return json(
      { status: body.ok ? "invalid" : body.reason },
      body.ok ? 400 : body.status,
    );
  }
  const documentId = ownProperty(body.value, "documentId");
  if (typeof documentId !== "string" || !UUID.test(documentId)) {
    return json({ status: "invalid" }, 400);
  }

  const runtimeState = await createEvidenceShadowRuntime();
  if (runtimeState.status !== "ready") {
    return json({ status: "unavailable" }, 503);
  }

  const outcome = await runtimeState.runtime.ensurePackage({
    actorId: session.user.id,
    documentId,
  });

  if (outcome.status === "ok") {
    return json(
      {
        status: "ok",
        evidencePackageId: outcome.context.evidencePackageId,
        evidenceProfileId: outcome.context.evidenceProfileId,
        maxPayloadBytes: outcome.context.maxPayloadBytes,
        acceptsEvidence: outcome.context.acceptsEvidence,
      },
      200,
    );
  }
  if (outcome.status === "not_found") {
    return json({ status: "not_found" }, 404);
  }
  if (outcome.status === "profile_conflict") {
    return json({ status: "profile_conflict" }, 409);
  }
  if (outcome.status === "invalid") {
    return json({ status: "invalid" }, 400);
  }
  return json({ status: "unavailable" }, 503);
}
