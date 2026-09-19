import { fetchJson, normalizeUsage } from "./base.mjs";

const BASE = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";

export const anthropicAdapter = {
  provider: "anthropic",
  supportsExactTokenCount: true,

  async countTokens({ apiKey, model, prompt, context = "", instructions = "", effort = "provider-default", cacheTtl = "5m", timeoutMs }) {
    requireKey(apiKey);
    const body = buildBody({ model, prompt, context, instructions, effort, cacheTtl });
    delete body.max_tokens;
    const data = await fetchJson({
      provider: "anthropic", operation: "count_tokens", url: BASE + "/messages/count_tokens",
      headers: { "x-api-key": apiKey, "anthropic-version": VERSION }, body, timeoutMs
    });
    return { inputTokens: data.input_tokens || 0, method: "provider-exact" };
  },

  async generate({ apiKey, model, prompt, context = "", instructions = "", effort = "provider-default",
    maxOutputTokens = 4096, cacheTtl = "5m", timeoutMs }) {
    requireKey(apiKey);
    const body = buildBody({ model, prompt, context, instructions, effort, cacheTtl });
    body.max_tokens = maxOutputTokens;
    const started = Date.now();
    const data = await fetchJson({
      provider: "anthropic", operation: "generate", url: BASE + "/messages",
      headers: { "x-api-key": apiKey, "anthropic-version": VERSION }, body, timeoutMs
    });
    const usage = data.usage || {};
    const cacheWrite = usage.cache_creation_input_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const uncached = usage.input_tokens || 0;
    const output = usage.output_tokens || 0;
    const reasoning = usage.output_tokens_details?.thinking_tokens ?? null;
    return {
      text: (data.content || []).filter((x) => x?.type === "text").map((x) => x.text).join("\n"),
      status: data.stop_reason || "completed",
      responseId: data.id || null,
      latencyMs: Date.now() - started,
      usage: normalizeUsage({
        inputTokens: uncached + cacheWrite + cacheRead,
        uncachedInputTokens: uncached,
        cachedInputTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        outputTokens: output,
        visibleOutputTokens: reasoning == null ? null : Math.max(0, output - reasoning),
        reasoningTokens: reasoning
      })
    };
  }
};

function buildBody({ model, prompt, context, instructions, effort, cacheTtl }) {
  const messages = [{
    role: "user",
    content: [
      ...(context ? [{ type: "text", text: "CONTEXT\n" + context }] : []),
      { type: "text", text: "TASK\n" + String(prompt || "") }
    ]
  }];
  const body = { model, messages, cache_control: { type: "ephemeral", ttl: cacheTtl === "1h" ? "1h" : "5m" } };
  if (instructions) body.system = [{ type: "text", text: instructions }];
  if (!model.includes("haiku-4-5")) {
    body.thinking = { type: "adaptive" };
    if (effort !== "provider-default") body.output_config = { effort };
  }
  return body;
}
function requireKey(apiKey) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
}
