import { countAiRequest, executeAiRequest, previewAiRequest } from "../../src/ai-router/service.mjs";
import { buildTelemetry, persistTelemetry } from "../../src/ai-router/telemetry.mjs";

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const requestId = crypto.randomUUID();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ requestId, error: "Request body must be valid JSON." }, 400);
  }

  const mode = body.mode || "preview";
  if (!["preview", "count", "execute"].includes(mode)) {
    return json({ requestId, error: "mode must be preview, count, or execute." }, 400);
  }

  if (mode !== "preview" && !authorized(request, process.env)) {
    return json({ requestId, error: "Protected AI Router mode requires server authorization." }, 401);
  }

  try {
    let result;
    if (mode === "preview") result = previewAiRequest(body, process.env);
    if (mode === "count") result = await countAiRequest(body, process.env);
    if (mode === "execute") result = await executeAiRequest(body, process.env);

    const shouldPersist = mode !== "preview" || process.env.AI_ROUTER_LOG_PREVIEWS === "true";
    let telemetry = { stored: false, reason: "preview-disabled" };
    if (shouldPersist) {
      telemetry = await persistTelemetry(buildTelemetry({ requestId, mode, result }), process.env);
    }

    return json({ requestId, mode, ...result, telemetry }, 200);
  } catch (error) {
    console.error("AI router request failed", { requestId, mode, message: error?.message });
    return json({ requestId, mode, error: error?.message || "AI Router failed." }, error?.status >= 400 && error?.status < 600 ? error.status : 400);
  }
}

function authorized(request, env) {
  const secret = env.AI_ROUTER_SHARED_SECRET;
  if (!secret) return false;
  const authorization = request.headers.get("authorization") || "";
  return authorization === "Bearer " + secret;
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
