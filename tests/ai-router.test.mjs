import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CATALOG } from "../src/ai-router/catalog.mjs";
import { analyzeTask, predictTokenBudget, roughInputTokens, routeModels } from "../src/ai-router/core.mjs";
import handler from "../netlify/functions/ai-router.mjs";

test("roughInputTokens returns a bounded positive estimate", () => {
  const tokens = roughInputTokens({ prompt: "Napiši kratak sažetak." });
  assert.ok(tokens > 0);
  assert.ok(tokens < 200);
});

test("standard simple request can use the cheapest bootstrap tier", () => {
  const analysis = analyzeTask({ prompt: "Sažmi ovaj odlomak u dvije rečenice.", profile: "standard" });
  const inputTokens = 1000;
  const routing = routeModels({ catalog: DEFAULT_CATALOG, inputTokens, analysis, profile: "standard" });
  assert.equal(routing.recommended.model, "gpt-5.6-luna");
  assert.equal(routing.recommended.tier, 1);
});

test("critical profile requires the strongest bootstrap tier", () => {
  const analysis = analyzeTask({ prompt: "Audit production release and security migration before merge.", profile: "critical" });
  const routing = routeModels({ catalog: DEFAULT_CATALOG, inputTokens: 5000, analysis, profile: "critical" });
  assert.equal(analysis.requiredTier, 3);
  assert.equal(routing.recommended.model, "gpt-5.6-sol");
});

test("P90 token budgets are never lower than P50", () => {
  const analysis = analyzeTask({ prompt: "Analiziraj rezultate istraživanja i objasni metodologiju.", profile: "quality" });
  const budget = predictTokenBudget({ inputTokens: 4000, analysis, effort: "high" });
  assert.ok(budget.visibleOutput.p90 >= budget.visibleOutput.p50);
  assert.ok(budget.reasoning.p90 >= budget.reasoning.p50);
  assert.equal(budget.totalBilledOutput.p90, budget.visibleOutput.p90 + budget.reasoning.p90);
});

test("router orders eligible models by estimated P90 cost", () => {
  const analysis = analyzeTask({ prompt: "Napiši kratko objašnjenje.", profile: "standard" });
  const routing = routeModels({ catalog: DEFAULT_CATALOG, inputTokens: 2000, analysis, profile: "standard" });
  for (let i = 1; i < routing.candidates.length; i += 1) {
    assert.ok(routing.candidates[i].estimatedCostUsd >= routing.candidates[i - 1].estimatedCostUsd);
  }
});

test("Netlify preview endpoint returns routing without provider credentials", async () => {
  const request = new Request("http://localhost/api/ai-router", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "preview",
      profile: "standard",
      prompt: "Sažmi ovaj tekst u tri točke."
    })
  });
  const response = await handler(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, "preview");
  assert.equal(body.inputTokens.method, "heuristic");
  assert.ok(body.routing.recommended);
});

test("protected modes reject requests without server authorization", async () => {
  const request = new Request("http://localhost/api/ai-router", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "count",
      prompt: "Test"
    })
  });
  const response = await handler(request);
  assert.equal(response.status, 401);
});
