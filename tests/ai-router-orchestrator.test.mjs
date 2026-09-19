import test from "node:test";
import assert from "node:assert/strict";
import { ProviderError, normalizeUsage } from "../src/ai-router/providers/base.mjs";
import { executeAiRequest } from "../src/ai-router/service.mjs";

function model(provider, name, capabilityRank, input = 0.1, output = 0.5) {
  return {
    provider, model: name, displayName: name, capabilityRank, stability: "stable", latencyClass: "fast",
    contextWindow: 100000, maxOutputTokens: 10000, reasoningModes: ["low", "medium", "high"],
    supportsTools: true, supportsStructuredOutput: true, supportsImages: false, supportsFiles: false,
    supportsCaching: false, supportsTokenCounting: true,
    pricing: { inputUsdPerM: input, outputUsdPerM: output, outputIncludesReasoning: true }
  };
}
function success(text = "ok") {
  return {
    text, status: "completed", responseId: "r", latencyMs: 5,
    usage: normalizeUsage({ inputTokens: 100, outputTokens: 20, visibleOutputTokens: 20, reasoningTokens: 0 })
  };
}
const count = async () => ({ inputTokens: 100, method: "provider-exact" });

test("transient provider failure retries the same model without escalation", async () => {
  let calls = 0;
  const adapters = {
    openai: {
      supportsExactTokenCount: true, countTokens: count,
      generate: async () => {
        calls += 1;
        if (calls === 1) throw new ProviderError({ provider: "openai", operation: "generate", status: 429,
          code: "PROVIDER_RATE_LIMITED", transient: true, message: "rate limited" });
        return success("valid answer");
      }
    }
  };
  const result = await executeAiRequest(
    { prompt: "Objasni kratko pojam.", profile: "economy", budget: { maxRetries: 1, maxEscalations: 0 } },
    { OPENAI_API_KEY: "x" },
    { registry: [model("openai", "cheap", 2)], adapters, availableProviders: ["openai"] }
  );
  assert.equal(result.execution.retryCount, 1);
  assert.equal(result.execution.escalationCount, 0);
  assert.equal(result.execution.finalSuccess, true);
  assert.equal(result.attempts[0].attemptKind, "initial");
  assert.equal(result.attempts[1].attemptKind, "retry");
});

test("operational failure falls back to a compatible different provider", async () => {
  const adapters = {
    openai: {
      supportsExactTokenCount: true, countTokens: count,
      generate: async () => { throw new ProviderError({ provider: "openai", operation: "generate", status: 503,
        code: "PROVIDER_HTTP_ERROR", transient: true, message: "down" }); }
    },
    anthropic: { supportsExactTokenCount: true, countTokens: count, generate: async () => success("fallback answer") }
  };
  const registry = [
    model("openai", "cheap", 2, 0.05, 0.2),
    model("anthropic", "backup", 2, 0.2, 0.8)
  ];
  const result = await executeAiRequest(
    { prompt: "Objasni kratko pojam.", profile: "economy", budget: { maxRetries: 0, maxEscalations: 0 } },
    { OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "y" },
    { registry, adapters, availableProviders: ["openai", "anthropic"] }
  );
  assert.equal(result.execution.fallbackCount, 1);
  assert.equal(result.execution.escalationCount, 0);
  assert.equal(result.execution.provider, "anthropic");
});

test("verifier failure escalates to a stronger candidate with corrective context", async () => {
  const seenPrompts = [];
  const adapters = {
    openai: {
      supportsExactTokenCount: true,
      countTokens: count,
      generate: async ({ model: modelName, prompt }) => {
        seenPrompts.push(prompt);
        return modelName === "cheap" ? success("{bad json") : success('{"name":"Ana"}');
      }
    }
  };
  const registry = [model("openai", "cheap", 2, 0.05, 0.2), model("openai", "strong", 3, 0.2, 0.8)];
  const result = await executeAiRequest(
    {
      prompt: "Izvuci podatke u JSON.",
      profile: "balanced",
      requirements: { structuredOutput: true },
      verification: { jsonSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } } },
      budget: { maxRetries: 0, maxEscalations: 1 }
    },
    { OPENAI_API_KEY: "x" },
    { registry, adapters, availableProviders: ["openai"] }
  );
  assert.equal(result.execution.escalationCount, 1);
  assert.equal(result.execution.finalSuccess, true);
  assert.equal(result.execution.model, "strong");
  assert.match(seenPrompts[1], /VERIFICATION FAILURES/);
  assert.match(seenPrompts[1], /ORIGINAL TASK/);
});

test("strict aggregate budget stops before an additional attempt", async () => {
  const adapters = {
    openai: {
      supportsExactTokenCount: true, countTokens: count,
      generate: async () => success("{bad")
    }
  };
  const registry = [model("openai", "cheap", 2, 1000, 1000), model("openai", "strong", 3, 1000, 1000)];
  await assert.rejects(
    () => executeAiRequest(
      {
        prompt: "Izvuci podatke u JSON.", profile: "balanced", requirements: { structuredOutput: true },
        verification: { jsonSchema: { type: "object", required: ["name"] } },
        budget: { maxCostUsd: 0.2, maxRetries: 0, maxEscalations: 1 }
      },
      { OPENAI_API_KEY: "x" },
      { registry, adapters, availableProviders: ["openai"] }
    ),
    (error) => ["AGGREGATE_COST_BUDGET_EXCEEDED", "NO_VALID_CANDIDATE"].includes(error.code)
  );
});


test("explicit arbitrary tool execution is blocked until a permissioned broker exists", async () => {
  await assert.rejects(
    () => executeAiRequest(
      { prompt: "Search the web.", requirements: { tools: true } },
      { OPENAI_API_KEY: "x" },
      { registry: [model("openai", "cheap", 2)], adapters: {}, availableProviders: ["openai"] }
    ),
    (error) => error.code === "TOOL_BROKER_REQUIRED" && error.status === 501
  );
});


test("terminal provider failure preserves partial attempt telemetry on the error", async () => {
  const adapters = {
    openai: {
      supportsExactTokenCount: true,
      countTokens: count,
      generate: async () => {
        throw new ProviderError({
          provider: "openai",
          operation: "generate",
          status: 500,
          code: "PROVIDER_HTTP_ERROR",
          transient: false,
          message: "provider failed"
        });
      }
    }
  };
  await assert.rejects(
    () => executeAiRequest(
      { prompt: "Objasni kratko pojam.", profile: "economy", budget: { maxRetries: 0, maxEscalations: 0 } },
      { OPENAI_API_KEY: "x" },
      { registry: [model("openai", "only", 2)], adapters, availableProviders: ["openai"] }
    ),
    (error) => {
      assert.equal(error.code, "PROVIDER_FALLBACK_EXHAUSTED");
      assert.equal(error.partialResult?.attempts?.length, 1);
      assert.equal(error.partialResult?.attempts?.[0]?.errorType, "PROVIDER_HTTP_ERROR");
      return true;
    }
  );
});
