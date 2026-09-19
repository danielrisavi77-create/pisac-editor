import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTaskV2 } from "../src/ai-router/classifier.mjs";
import { optimizeContext, roughInputTokens } from "../src/ai-router/context.mjs";
import { predictTokenBudgetV2 } from "../src/ai-router/predictor.mjs";
import fs from "node:fs/promises";
import { resolvePricing } from "../src/ai-router/pricing.mjs";
import { DEFAULT_MODEL_REGISTRY } from "../src/ai-router/registry.mjs";
import { generateCandidates } from "../src/ai-router/router.mjs";
import { verifyResult } from "../src/ai-router/verifier.mjs";
import handler from "../netlify/functions/ai-router.mjs";

test("registry is provider-neutral and contains current provider families", () => {
  const providers = new Set(DEFAULT_MODEL_REGISTRY.map((x) => x.provider));
  assert.deepEqual([...providers].sort(), ["anthropic", "google", "openai", "xai"]);
  assert.ok(DEFAULT_MODEL_REGISTRY.every((x) => x.sourceCheckedAt === "2026-09-19"));
  const astra = DEFAULT_MODEL_REGISTRY.find((x) => x.model === "gpt-6-astra");
  assert.equal(astra.capabilityRank, 5);
  assert.equal(astra.pricing.cacheWriteUsdPerM, 12.5);
});

test("classifier distinguishes core V2 task types and high risk", () => {
  assert.equal(analyzeTaskV2({ prompt: "Prevedi ovaj tekst na engleski." }).taskType, "translation");
  assert.equal(analyzeTaskV2({ prompt: "Debugiraj failing test i stack trace." }).taskType, "debugging");
  assert.equal(analyzeTaskV2({ prompt: "Analiziraj repository i codebase." }).taskType, "repository_analysis");
  const risky = analyzeTaskV2({ prompt: "Audit production security migration prije deploya.", profile: "critical" });
  assert.ok(risky.risk >= 0.5);
});

test("context optimizer removes duplicates and preserves mandatory error evidence", () => {
  const result = optimizeContext({
    prompt: "Popravi test",
    contextSegments: [
      { text: "nebitan sadržaj ".repeat(100), type: "user" },
      { text: "nebitan sadržaj ".repeat(100), type: "user" },
      { text: "TypeError: x is undefined", type: "error" }
    ],
    maxContextTokens: 40
  });
  assert.equal(result.stats.duplicateSegmentsRemoved, 1);
  assert.match(result.text, /TypeError/);
  assert.ok(result.stats.tokensAfter <= result.stats.tokensBefore);
});

test("token predictor preserves P50 <= P90 <= P95", () => {
  const model = DEFAULT_MODEL_REGISTRY.find((x) => x.model === "gpt-5.6-terra");
  const analysis = analyzeTaskV2({ prompt: "Analiziraj metodologiju istraživanja." });
  const budget = predictTokenBudgetV2({ inputTokens: 4000, analysis, model, effort: "high" });
  assert.ok(budget.visibleOutput.p50 <= budget.visibleOutput.p90);
  assert.ok(budget.visibleOutput.p90 <= budget.visibleOutput.p95);
  assert.ok(budget.reasoning.p50 <= budget.reasoning.p90);
  assert.ok(budget.billedOutput.p95 >= budget.visibleOutput.p95);
});

test("provider-specific long-context pricing is applied", () => {
  const sol = DEFAULT_MODEL_REGISTRY.find((x) => x.model === "gpt-5.6-sol");
  const openaiLong = resolvePricing(sol, 300000);
  assert.equal(openaiLong.inputUsdPerM, 8);
  assert.equal(openaiLong.outputUsdPerM, 30);

  const geminiPro = DEFAULT_MODEL_REGISTRY.find((x) => x.model === "gemini-3.1-pro-preview");
  const googleLong = resolvePricing(geminiPro, 210000);
  assert.equal(googleLong.inputUsdPerM, 4);
  assert.equal(googleLong.outputUsdPerM, 18);
});

test("heuristic routing never invents a success probability", () => {
  const analysis = analyzeTaskV2({ prompt: "Sažmi tekst u tri točke." });
  const routing = generateCandidates({
    registry: DEFAULT_MODEL_REGISTRY,
    inputTokens: 1000,
    analysis,
    profile: "balanced"
  });
  assert.ok(routing.recommended);
  assert.equal(routing.recommended.quality.source, "heuristic");
  assert.equal(routing.recommended.quality.successProbability, null);
  assert.equal(routing.recommended.expectedCostPerSuccessfulTaskUsd, null);
});

test("budget contract returns no candidate instead of silently exceeding max cost", () => {
  const analysis = analyzeTaskV2({ prompt: "Napiši detaljnu analizu." });
  const routing = generateCandidates({
    registry: DEFAULT_MODEL_REGISTRY,
    inputTokens: 5000,
    analysis,
    profile: "balanced",
    budget: { maxCostUsd: 0.0000001 }
  });
  assert.equal(routing.recommended, null);
  assert.equal(routing.noCandidateReason.code, "NO_VALID_CANDIDATE");
  assert.ok(routing.noCandidateReason.rejectionCounts.max_cost_exceeded > 0);
});

test("numeric minQuality rejects heuristic candidates rather than pretending the threshold is met", () => {
  const analysis = analyzeTaskV2({ prompt: "Sažmi ovaj tekst." });
  const routing = generateCandidates({
    registry: DEFAULT_MODEL_REGISTRY,
    inputTokens: 1000,
    analysis,
    profile: "balanced",
    budget: { minQuality: 0.9 }
  });
  assert.equal(routing.recommended, null);
  assert.ok(routing.noCandidateReason.rejectionCounts.min_quality_unverifiable > 0);
});

test("structured verifier validates JSON schema contract", () => {
  const analysis = { verificationType: "structured" };
  const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } } };
  assert.equal(verifyResult({ text: "{\"name\":\"Ana\"}", analysis, verification: { jsonSchema: schema } }).passed, true);
  const failed = verifyResult({ text: "{\"age\":2}", analysis, verification: { jsonSchema: schema } });
  assert.equal(failed.passed, false);
  assert.ok(failed.failures.some((x) => x.code === "required_field_missing"));
});

test("rough token estimate stays explicitly approximate", () => {
  const value = roughInputTokens({ prompt: "Kratak tekst" });
  assert.ok(value > 0);
});

test("Netlify preview is public but does not echo optimized private context", async () => {
  const request = new Request("http://localhost/api/ai-router", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "preview", prompt: "Sažmi tekst.", context: "privatni kontekst" })
  });
  const response = await handler(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.inputTokens.method, "heuristic");
  assert.equal("optimizedContext" in body, false);
  assert.ok(body.routing.recommended);
});

test("protected modes reject unauthenticated requests and malformed JSON", async () => {
  const denied = await handler(new Request("http://localhost/api/ai-router", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "count", prompt: "Test" })
  }));
  assert.equal(denied.status, 401);

  const malformed = await handler(new Request("http://localhost/api/ai-router", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{"
  }));
  assert.equal(malformed.status, 400);
});


test("Haiku 4.5 does not receive phantom reasoning budget", () => {
  const haiku = DEFAULT_MODEL_REGISTRY.find((x) => x.model === "claude-haiku-4-5-20251001");
  assert.deepEqual(haiku.reasoningModes, ["none"]);
  const analysis = analyzeTaskV2({ prompt: "Sažmi ovaj tekst." });
  const budget = predictTokenBudgetV2({ inputTokens: 1000, analysis, model: haiku, effort: "none" });
  assert.equal(budget.reasoning.p50, 0);
  assert.equal(budget.reasoning.p90, 0);
});

test("empirical token calibration treats visible output and reasoning exactly once", () => {
  const model = DEFAULT_MODEL_REGISTRY.find((x) => x.model === "gpt-5.6-terra");
  const analysis = analyzeTaskV2({ prompt: "Sažmi ovaj tekst." });
  const budget = predictTokenBudgetV2({
    inputTokens: 1000,
    analysis,
    model,
    effort: "medium",
    calibration: {
      sampleCount: 40,
      outputMedian: 100,
      outputP90: 180,
      outputP95: 210,
      reasoningMedian: 50,
      reasoningP90: 90,
      reasoningP95: 110
    }
  });
  assert.equal(budget.source, "production-empirical");
  assert.equal(budget.visibleOutput.p50, 100);
  assert.equal(budget.reasoning.p50, 50);
  assert.equal(budget.billedOutput.p50, 150);
  assert.equal(budget.billedOutput.p90, 270);
});

test("empirical routing exposes final success separately from first-pass retry and escalation", () => {
  const registry = DEFAULT_MODEL_REGISTRY.filter((x) =>
    x.model === "gpt-5.6-luna" || x.model === "gpt-5.6-terra"
  );
  const analysis = analyzeTaskV2({ prompt: "Sažmi ovaj tekst u tri točke." });
  const calibration = {};
  for (const model of registry) {
    const key = [analysis.taskType, model.provider, model.model, "none"].join("|");
    calibration[key] = {
      sampleCount: 40,
      initialSampleCount: 40,
      outputMedian: 120,
      outputP90: 200,
      outputP95: 230,
      reasoningMedian: 0,
      reasoningP90: 0,
      reasoningP95: 0,
      successRate: 0.95,
      firstPassSuccessRate: 0.70,
      retryRate: 0.15,
      escalationRate: 0.10,
      expectedQualityScore: 0.92,
      medianLatencyMs: 800
    };
  }
  const routing = generateCandidates({
    registry,
    inputTokens: 1000,
    analysis,
    profile: "economy",
    calibration
  });
  const candidate = routing.recommended;
  assert.equal(candidate.quality.source, "production-empirical");
  assert.equal(candidate.quality.successProbability, 0.95);
  assert.equal(candidate.quality.firstPassSuccessProbability, 0.70);
  assert.equal(candidate.quality.needsRetryProbability, 0.15);
  assert.equal(candidate.quality.needsEscalationProbability, 0.10);
  assert.equal(candidate.quality.expectedQuality, 0.92);
  assert.ok(candidate.expectedRetryCostUsd > 0);
  assert.ok(candidate.expectedTotalCostUsd > candidate.estimatedCost.totalUsd);
  assert.ok(candidate.expectedCostPerSuccessfulTaskUsd >= candidate.expectedTotalCostUsd);
  assert.equal(routing.selectionMethod, "expected-cost-per-verified-success");
});

test("V2 migration keeps calibration private and separates visible output from reasoning", async () => {
  const sql = await fs.readFile(new URL("../supabase/migrations/2026091902_ai_router_v2.sql", import.meta.url), "utf8");
  assert.match(sql, /visible_output_tokens_actual integer/);
  assert.match(sql, /first_pass_success_rate/);
  assert.match(sql, /final_success/);
  assert.match(sql, /security_invoker = true/);
  assert.match(sql, /revoke all on public\.ai_router_calibration_stats from anon, authenticated/);
  assert.match(sql, /grant select on public\.ai_router_calibration_stats to service_role/);
});


test("Gemini Flash-Lite exposes minimal thinking for low-cost routing", () => {
  const flashLite = DEFAULT_MODEL_REGISTRY.find((x) => x.model === "gemini-3.5-flash-lite");
  assert.ok(flashLite.reasoningModes.includes("minimal"));
  const analysis = analyzeTaskV2({ prompt: "Klasificiraj ovu poruku.", profile: "economy" });
  const routing = generateCandidates({
    registry: [flashLite],
    inputTokens: 500,
    analysis,
    profile: "economy"
  });
  assert.equal(routing.recommended.effort, "minimal");
  assert.ok(routing.recommended.tokenBudget.reasoning.p50 > 0);
  assert.ok(routing.recommended.tokenBudget.reasoning.p50 < 100);
});
