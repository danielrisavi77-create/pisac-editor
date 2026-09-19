import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import handler from "../netlify/functions/ai-router.mjs";
import {
  claimLocalRateSlot,
  enforceRateLimit,
  resetLocalRateLimitsForTests,
  resolveRateLimitActor,
  resolveRateLimitConfig
} from "../src/ai-router/rate-limit.mjs";

test("rate-limit config uses separate preview count and execute budgets", () => {
  const env = {
    AI_ROUTER_RATE_LIMIT_PREVIEW_PER_MINUTE: "120",
    AI_ROUTER_RATE_LIMIT_COUNT_PER_MINUTE: "50",
    AI_ROUTER_RATE_LIMIT_EXECUTE_PER_MINUTE: "10",
    AI_ROUTER_RATE_LIMIT_WINDOW_SECONDS: "60"
  };
  assert.equal(resolveRateLimitConfig("preview", env).limit, 120);
  assert.equal(resolveRateLimitConfig("count", env).limit, 50);
  assert.equal(resolveRateLimitConfig("execute", env).limit, 10);
});

test("preview ignores spoofable user identity while protected modes may use trusted caller identity", () => {
  const request = new Request("https://example.test/api/ai-router", {
    headers: {
      "x-ai-router-user-id": "user-123",
      "x-ai-router-service-id": "pisac-web",
      "x-nf-client-connection-ip": "203.0.113.5"
    }
  });
  assert.deepEqual(resolveRateLimitActor(request, "preview"), {
    kind: "ip",
    value: "203.0.113.5"
  });
  assert.deepEqual(resolveRateLimitActor(request, "execute"), {
    kind: "user",
    value: "user-123"
  });
});

test("instance-local fallback enforces the limit under concurrent claims", async () => {
  resetLocalRateLimitsForTests();
  const config = { limit: 3, windowSeconds: 60, distributed: false };
  const claims = await Promise.all(
    Array.from({ length: 10 }, () => Promise.resolve(
      claimLocalRateSlot({
        identityHash: "a".repeat(64),
        actorKind: "service",
        mode: "execute",
        config,
        nowMs: 1_000_000
      })
    ))
  );
  assert.equal(claims.filter((x) => x.allowed).length, 3);
  assert.equal(claims.filter((x) => !x.allowed).length, 7);
  assert.equal(Math.max(...claims.map((x) => x.currentCount)), 10);
});

test("distributed limiter sends only HMAC identity and uses atomic RPC result", async () => {
  let captured = null;
  const request = new Request("https://example.test/api/ai-router", {
    headers: {
      "x-ai-router-user-id": "student@example.test",
      "x-nf-client-connection-ip": "203.0.113.5"
    }
  });
  const result = await enforceRateLimit({
    request,
    mode: "execute",
    requestId: "req-1",
    env: {
      AI_ROUTER_DISTRIBUTED_RATE_LIMIT_ENABLED: "true",
      AI_ROUTER_RATE_LIMIT_SALT: "unit-test-salt",
      AI_ROUTER_RATE_LIMIT_EXECUTE_PER_MINUTE: "2",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test"
    },
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body), headers: options.headers };
      return new Response(JSON.stringify({
        allowed: true,
        limit: 2,
        current_count: 1,
        remaining: 1,
        retry_after_seconds: 0,
        window_seconds: 60,
        window_start: "2026-09-19T10:00:00Z",
        window_end: "2026-09-19T10:01:00Z"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(result.allowed, true);
  assert.equal(result.source, "supabase-distributed");
  assert.match(captured.url, /\/rest\/v1\/rpc\/claim_ai_router_rate_slot$/);
  assert.match(captured.body.p_identity_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(captured.body).includes("student@example.test"), false);
  assert.equal(JSON.stringify(captured.body).includes("203.0.113.5"), false);
  assert.equal(captured.body.p_scope, "execute");
  assert.equal(captured.body.p_limit, 2);
});

test("distributed limiter fails closed when required server configuration is absent", async () => {
  const request = new Request("https://example.test/api/ai-router", {
    headers: { "x-nf-client-connection-ip": "203.0.113.5" }
  });
  await assert.rejects(
    () => enforceRateLimit({
      request,
      mode: "preview",
      requestId: "req-2",
      env: { AI_ROUTER_DISTRIBUTED_RATE_LIMIT_ENABLED: "true" }
    }),
    (error) => error.code === "RATE_LIMIT_UNAVAILABLE" && error.status === 503
  );
});

test("Netlify boundary returns structured 429 with Retry-After", { concurrency: false }, async () => {
  resetLocalRateLimitsForTests();
  const previous = {
    distributed: process.env.AI_ROUTER_DISTRIBUTED_RATE_LIMIT_ENABLED,
    preview: process.env.AI_ROUTER_RATE_LIMIT_PREVIEW_PER_MINUTE,
    window: process.env.AI_ROUTER_RATE_LIMIT_WINDOW_SECONDS
  };
  process.env.AI_ROUTER_DISTRIBUTED_RATE_LIMIT_ENABLED = "false";
  process.env.AI_ROUTER_RATE_LIMIT_PREVIEW_PER_MINUTE = "1";
  process.env.AI_ROUTER_RATE_LIMIT_WINDOW_SECONDS = "60";

  const makeRequest = () => new Request("http://localhost/api/ai-router", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nf-client-connection-ip": "203.0.113.22"
    },
    body: JSON.stringify({ mode: "preview", prompt: "Sažmi ovu rečenicu." })
  });

  try {
    const first = await handler(makeRequest());
    const second = await handler(makeRequest());
    const body = await second.json();
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.ok(Number(second.headers.get("retry-after")) >= 1);
    assert.equal(second.headers.get("x-ratelimit-limit"), "1");
    assert.equal(second.headers.get("x-ratelimit-remaining"), "0");
  } finally {
    restoreEnv("AI_ROUTER_DISTRIBUTED_RATE_LIMIT_ENABLED", previous.distributed);
    restoreEnv("AI_ROUTER_RATE_LIMIT_PREVIEW_PER_MINUTE", previous.preview);
    restoreEnv("AI_ROUTER_RATE_LIMIT_WINDOW_SECONDS", previous.window);
    resetLocalRateLimitsForTests();
  }
});

test("V2 SQL uses atomic upsert and service-role-only limiter access", async () => {
  const sql = await fs.readFile(
    new URL("../supabase/migrations/2026091902_ai_router_v2.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /insert into private\.ai_router_rate_limits as rl/i);
  assert.match(sql, /on conflict \(identity_hash, scope, window_start\)/i);
  assert.match(sql, /request_count = rl\.request_count \+ 1/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /revoke all on function public\.claim_ai_router_rate_slot[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.claim_ai_router_rate_slot[\s\S]*to service_role/i);
  assert.match(sql, /No prompt, output, raw IP, user ID, auth header, or provider payload/i);
});

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
