import { NextResponse } from "next/server";

import { isEvidenceIngestCommandV2 } from "@/application/ports/evidence-ingest";
import { getEvidenceShadowConfig } from "@/lib/evidence/shadow-config";
import {
  isPinnedSameOrigin,
  readJsonBodyLimited,
} from "@/lib/evidence/shadow-http";
import { createEvidenceShadowRuntime } from "@/lib/evidence/shadow-runtime";
import { getEvidenceShadowSession } from "@/lib/evidence/shadow-session";

export const runtime = "nodejs";

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

  const body = await readJsonBodyLimited(
    request,
    config.value.maxCommandBytes,
  );
  if (!body.ok) return json({ status: body.reason }, body.status);
  if (!isEvidenceIngestCommandV2(body.value)) {
    return json({ status: "invalid" }, 400);
  }

  const runtimeState = await createEvidenceShadowRuntime();
  if (runtimeState.status !== "ready") {
    return json({ status: "unavailable" }, 503);
  }

  const outcome = await runtimeState.runtime.gateway.ingest({
    principalId: session.user.id,
    command: body.value,
    authorizationContext: {
      currentTime: new Date().toISOString(),
    },
  });

  switch (outcome.status) {
    case "accepted":
    case "duplicate":
      return json(
        {
          status: outcome.status,
          receipt: outcome.receipt,
        },
        200,
      );
    case "invalid":
      return json({ status: "invalid" }, 400);
    case "unauthorized":
      return json({ status: "unauthorized" }, 403);
    case "too_large":
      return json({ status: "too_large" }, 413);
    case "not_accepting":
      return json({ status: "not_accepting" }, 409);
    case "idempotency_conflict":
      return json({ status: "idempotency_conflict" }, 409);
    case "chain_conflict":
      return json(
        {
          status: "chain_conflict",
          expectedPreviousSegmentHash:
            outcome.expectedPreviousSegmentHash,
        },
        409,
      );
    case "unavailable":
      return json(
        {
          status: "unavailable",
          stage: outcome.stage,
        },
        503,
      );
  }
}
