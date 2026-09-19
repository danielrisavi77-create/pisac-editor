import { createHash, createHmac } from "node:crypto";
import { RouterError } from "./errors.mjs";

const localBuckets = new Map();

const DEFAULT_LIMITS = Object.freeze({
  preview: 120,
  count: 60,
  execute: 20
});

export async function enforceRateLimit({
  request,
  mode,
  requestId,
  env = process.env,
  fetchImpl = fetch,
  nowMs = Date.now()
}) {
  const config = resolveRateLimitConfig(mode, env);
  const actor = resolveRateLimitActor(request, mode);
  const identityHash = pseudonymizeActor(actor, env, config.distributed);
  if (config.distributed) {
    return claimDistributedRateSlot({
      identityHash,
      actorKind: actor.kind,
      mode,
      requestId,
      config,
      env,
      fetchImpl
    });
  }
  return claimLocalRateSlot({ identityHash, actorKind: actor.kind, mode, config, nowMs });
}

export function resolveRateLimitConfig(mode, env = process.env) {
  if (!["preview", "count", "execute"].includes(mode)) {
    throw new RouterError("INVALID_RATE_LIMIT_SCOPE", "Unsupported rate-limit scope.", 500);
  }
  const legacy = positiveInt(env.AI_ROUTER_RATE_LIMIT_PER_MINUTE, null);
  const specific = {
    preview: env.AI_ROUTER_RATE_LIMIT_PREVIEW_PER_MINUTE,
    count: env.AI_ROUTER_RATE_LIMIT_COUNT_PER_MINUTE,
    execute: env.AI_ROUTER_RATE_LIMIT_EXECUTE_PER_MINUTE
  }[mode];
  return {
    distributed: String(env.AI_ROUTER_DISTRIBUTED_RATE_LIMIT_ENABLED || "false").toLowerCase() === "true",
    limit: positiveInt(specific, legacy || DEFAULT_LIMITS[mode]),
    windowSeconds: positiveInt(env.AI_ROUTER_RATE_LIMIT_WINDOW_SECONDS, 60)
  };
}

export function resolveRateLimitActor(request, mode) {
  const protectedMode = mode !== "preview";
  if (protectedMode) {
    const userId = safeHeaderValue(request.headers.get("x-ai-router-user-id"));
    if (userId) return { kind: "user", value: userId };
    const serviceId = safeHeaderValue(request.headers.get("x-ai-router-service-id"));
    if (serviceId) return { kind: "service", value: serviceId };
  }
  return {
    kind: "ip",
    value: clientIp(request) || "unknown"
  };
}

export function claimLocalRateSlot({ identityHash, actorKind, mode, config, nowMs = Date.now() }) {
  const windowMs = config.windowSeconds * 1000;
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const key = [mode, identityHash, windowStartMs].join(":");
  const currentCount = (localBuckets.get(key) || 0) + 1;
  localBuckets.set(key, currentCount);
  pruneLocalBuckets(windowStartMs - windowMs * 2);
  const allowed = currentCount <= config.limit;
  const retryAfterSeconds = allowed
    ? 0
    : Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000));
  return {
    allowed,
    source: "instance-local",
    actorKind,
    limit: config.limit,
    currentCount,
    remaining: Math.max(0, config.limit - currentCount),
    retryAfterSeconds,
    windowSeconds: config.windowSeconds,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowStartMs + windowMs).toISOString()
  };
}

export async function claimDistributedRateSlot({
  identityHash,
  actorKind,
  mode,
  requestId,
  config,
  env,
  fetchImpl = fetch
}) {
  const missing = [];
  if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!env.AI_ROUTER_RATE_LIMIT_SALT) missing.push("AI_ROUTER_RATE_LIMIT_SALT");
  if (missing.length) {
    throw new RouterError(
      "RATE_LIMIT_UNAVAILABLE",
      "Distributed rate limiting is enabled but required server configuration is missing.",
      503,
      { missing }
    );
  }

  const base = String(env.SUPABASE_URL).replace(/\/$/, "");
  let response;
  try {
    response = await fetchImpl(base + "/rest/v1/rpc/claim_ai_router_rate_slot", {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_identity_hash: identityHash,
        p_scope: mode,
        p_window_seconds: config.windowSeconds,
        p_limit: config.limit,
        p_request_id: requestId || null
      })
    });
  } catch {
    throw new RouterError(
      "RATE_LIMIT_UNAVAILABLE",
      "Distributed rate limiter could not be reached.",
      503
    );
  }

  if (!response.ok) {
    throw new RouterError(
      "RATE_LIMIT_UNAVAILABLE",
      "Distributed rate limiter rejected the claim request.",
      503,
      { status: response.status }
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new RouterError("RATE_LIMIT_UNAVAILABLE", "Distributed rate limiter returned invalid JSON.", 503);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.allowed !== "boolean") {
    throw new RouterError("RATE_LIMIT_UNAVAILABLE", "Distributed rate limiter returned an invalid result.", 503);
  }

  return {
    allowed: row.allowed,
    source: "supabase-distributed",
    actorKind,
    limit: Number(row.limit ?? config.limit),
    currentCount: Number(row.current_count || 0),
    remaining: Number(row.remaining || 0),
    retryAfterSeconds: Number(row.retry_after_seconds || 0),
    windowSeconds: Number(row.window_seconds || config.windowSeconds),
    windowStart: row.window_start || null,
    windowEnd: row.window_end || null
  };
}

export function rateLimitHeaders(result) {
  if (!result) return {};
  const headers = {
    "x-ratelimit-limit": String(result.limit),
    "x-ratelimit-remaining": String(Math.max(0, result.remaining || 0)),
    "x-ratelimit-source": result.source
  };
  if (result.retryAfterSeconds > 0) {
    headers["retry-after"] = String(result.retryAfterSeconds);
  }
  if (result.windowEnd) {
    headers["x-ratelimit-reset"] = String(result.windowEnd);
  }
  return headers;
}

export function resetLocalRateLimitsForTests() {
  localBuckets.clear();
}

function pseudonymizeActor(actor, env, distributed) {
  const material = actor.kind + ":" + actor.value;
  const salt = String(env.AI_ROUTER_RATE_LIMIT_SALT || env.AI_ROUTER_SHARED_SECRET || "");
  if (distributed && !salt) {
    throw new RouterError(
      "RATE_LIMIT_UNAVAILABLE",
      "Distributed rate limiting requires AI_ROUTER_RATE_LIMIT_SALT.",
      503
    );
  }
  return salt
    ? createHmac("sha256", salt).update(material).digest("hex")
    : createHash("sha256").update(material).digest("hex");
}

function clientIp(request) {
  const direct = safeHeaderValue(request.headers.get("x-nf-client-connection-ip"));
  if (direct) return direct;
  const forwarded = safeHeaderValue(request.headers.get("x-forwarded-for"));
  return forwarded ? forwarded.split(",")[0].trim() : null;
}

function safeHeaderValue(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 256 || /[\r\n]/.test(text)) return null;
  return text;
}

function positiveInt(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pruneLocalBuckets(oldestWindowStartMs) {
  if (localBuckets.size < 1000) return;
  for (const key of localBuckets.keys()) {
    const windowStart = Number(key.split(":").at(-1));
    if (Number.isFinite(windowStart) && windowStart < oldestWindowStartMs) localBuckets.delete(key);
  }
}
