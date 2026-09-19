import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { loadCalibrationStats } from "../../src/ai-router/calibration.mjs";
import { safeErrorPayload } from "../../src/ai-router/errors.mjs";
import { countAiRequest, executeAiRequest, previewAiRequest } from "../../src/ai-router/service.mjs";
import { buildTelemetryBundle, persistTelemetryBundle } from "../../src/ai-router/telemetry.mjs";

const rateBuckets = new Map();
const MAX_BODY_BYTES = 2600000;

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }, 405);

  const requestId = randomUUID();
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return json({ requestId, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." } }, 413);

  let body;
  let rawBody;
  try {
    rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return json({ requestId, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." } }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return json({ requestId, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, 400);
  }

  const mode = body.mode || "preview";
  if (!["preview", "count", "execute"].includes(mode)) {
    return json({ requestId, error: { code: "INVALID_MODE", message: "mode must be preview, count, or execute." } }, 400);
  }

  if (mode !== "preview") {
    if (!authorized(request, process.env)) {
      return json({ requestId, error: { code: "UNAUTHORIZED", message: "Protected AI Router mode requires server authorization." } }, 401);
    }
    if (!withinRateLimit(request, process.env)) {
      return json({ requestId, error: { code: "RATE_LIMITED", message: "AI Router request rate limit exceeded." } }, 429);
    }
  }

  const promptFingerprint = fingerprint(body.prompt || "");
  let result = null;
  try {
    const deps = {};
    if (mode !== "preview" && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const preliminary = previewAiRequest(body, process.env);
      deps.calibration = await loadCalibrationStats({ taskType: preliminary.analysis.taskType }, process.env);
    }

    if (mode === "preview") result = previewAiRequest(body, process.env, deps);
    if (mode === "count") result = await countAiRequest(body, process.env, deps);
    if (mode === "execute") result = await executeAiRequest(body, process.env, deps);

    const shouldPersist = mode !== "preview" || process.env.AI_ROUTER_LOG_PREVIEWS === "true";
    let telemetry = { stored: false, reason: "preview-disabled" };
    if (shouldPersist) {
      telemetry = await persistTelemetryBundle(
        buildTelemetryBundle({ requestId, mode, result, promptFingerprint }),
        process.env
      );
    }
    return json({ requestId, mode, ...sanitizeResult(result), telemetry }, 200);
  } catch (error) {
    console.error("AI router request failed", {
      requestId,
      mode,
      code: error?.code || "ROUTER_ERROR",
      provider: error?.provider || null,
      status: error?.status || 500
    });
    if (mode !== "preview") {
      try {
        await persistTelemetryBundle(
          buildTelemetryBundle({ requestId, mode, result: error?.partialResult || result, promptFingerprint, error }),
          process.env
        );
      } catch {
        // Telemetry must never mask the original request failure.
      }
    }
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    return json({ requestId, mode, error: safeErrorPayload(error) }, status);
  }
}

function authorized(request, env) {
  const secret = String(env.AI_ROUTER_SHARED_SECRET || "");
  if (!secret) return false;
  const provided = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function withinRateLimit(request, env) {
  const limit = Math.max(1, Number(env.AI_ROUTER_RATE_LIMIT_PER_MINUTE || 60));
  const minute = Math.floor(Date.now() / 60000);
  const identity = [
    request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for") || "unknown",
    request.headers.get("authorization") || "no-auth"
  ].join("|");
  const key = fingerprint(identity) + ":" + minute;
  const current = (rateBuckets.get(key) || 0) + 1;
  rateBuckets.set(key, current);
  if (rateBuckets.size > 5000) {
    for (const storedKey of rateBuckets.keys()) if (!storedKey.endsWith(":" + minute)) rateBuckets.delete(storedKey);
  }
  return current <= limit;
}

function sanitizeResult(result) {
  if (!result) return result;
  const { optimizedContext: _privateContext, ...safe } = result;
  return safe;
}
function fingerprint(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
}
function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
