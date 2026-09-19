import test from "node:test";
import assert from "node:assert/strict";
import { ProviderError, normalizeUsage } from "../src/ai-router/providers/base.mjs";
import { anthropicAdapter } from "../src/ai-router/providers/anthropic.mjs";
import { geminiAdapter } from "../src/ai-router/providers/gemini.mjs";
import { openaiAdapter } from "../src/ai-router/providers/openai.mjs";
import { xaiAdapter } from "../src/ai-router/providers/xai.mjs";

test("normalized usage keeps cache and reasoning accounting separate", () => {
  const usage = normalizeUsage({
    inputTokens: 100, uncachedInputTokens: 70, cachedInputTokens: 20, cacheWriteTokens: 10,
    outputTokens: 50, visibleOutputTokens: 30, reasoningTokens: 20
  });
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.reasoningTokens, 20);
  assert.equal(usage.visibleOutputTokens, 30);
});

test("Anthropic adapter normalizes cache creation and cache reads", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("count_tokens")) return json({ input_tokens: 123 });
    return json({
      id: "msg_1", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 70, cache_creation_input_tokens: 20, cache_read_input_tokens: 10, output_tokens: 40, output_tokens_details: { thinking_tokens: 15 } }
    });
  };
  try {
    const counted = await anthropicAdapter.countTokens({ apiKey: "x", model: "claude-sonnet-5", prompt: "hello" });
    assert.equal(counted.inputTokens, 123);
    const result = await anthropicAdapter.generate({ apiKey: "x", model: "claude-sonnet-5", prompt: "hello", maxOutputTokens: 100 });
    assert.equal(result.usage.inputTokens, 100);
    assert.equal(result.usage.cacheWriteTokens, 20);
    assert.equal(result.usage.cachedInputTokens, 10);
    assert.equal(result.usage.reasoningTokens, 15);
    assert.equal(result.usage.visibleOutputTokens, 25);
  } finally { globalThis.fetch = oldFetch; }
});

test("Gemini adapter bills output plus thinking and sends lowercase thinkingLevel", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  let generationBody = null;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("countTokens")) return json({ totalTokens: 77 });
    generationBody = JSON.parse(options.body);
    return json({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "answer" }] } }],
      usageMetadata: { promptTokenCount: 80, cachedContentTokenCount: 20, candidatesTokenCount: 30, thoughtsTokenCount: 15, totalTokenCount: 125 }
    });
  };
  try {
    assert.equal((await geminiAdapter.countTokens({ apiKey: "x", model: "gemini-3.8-flash", prompt: "hello" })).inputTokens, 77);
    const result = await geminiAdapter.generate({ apiKey: "x", model: "gemini-3.8-flash", prompt: "hello", effort: "low", maxOutputTokens: 100 });
    assert.equal(generationBody.generationConfig.thinkingConfig.thinkingLevel, "low");
    assert.equal(result.usage.outputTokens, 45);
    assert.equal(result.usage.visibleOutputTokens, 30);
    assert.equal(result.usage.reasoningTokens, 15);
  } finally { globalThis.fetch = oldFetch; }
});

test("xAI adapter converts exact billed cost ticks to USD", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => json({
    id: "resp_1", status: "completed", output_text: "ok",
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, cost_in_usd_ticks: 25000000 }
  });
  try {
    const result = await xaiAdapter.generate({ apiKey: "x", model: "grok-4.6", prompt: "hello", maxOutputTokens: 100 });
    assert.equal(result.usage.providerCostUsd, 0.0025);
    assert.equal(xaiAdapter.supportsExactTokenCount, false);
  } finally { globalThis.fetch = oldFetch; }
});

test("provider errors are sanitized and transient 429 is retryable", { concurrency: false }, async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ error: { message: "bad sk-supersecret0000000000000000000000000000" } }, 429);
  try {
    await assert.rejects(
      () => openaiAdapter.countTokens({ apiKey: "x", model: "gpt-5.6-luna", prompt: "hello" }),
      (error) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.transient, true);
        assert.equal(error.code, "PROVIDER_RATE_LIMITED");
        assert.equal(error.message.includes("sk-supersecret"), false);
        return true;
      }
    );
  } finally { globalThis.fetch = oldFetch; }
});

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...(status === 429 ? { "retry-after": "0" } : {}) }
  });
}
