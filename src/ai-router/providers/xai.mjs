import { extractResponseText, fetchJson, normalizeUsage } from "./base.mjs";

const BASE = "https://api.x.ai/v1";

export const xaiAdapter = {
  provider: "xai",
  supportsExactTokenCount: false,

  async countTokens() {
    return { inputTokens: null, method: "heuristic-required", exactUnavailable: true };
  },

  async generate({ apiKey, model, prompt, context = "", instructions = "", effort = "high",
    maxOutputTokens = 4096, promptCacheKey = null, timeoutMs }) {
    requireKey(apiKey);
    const body = {
      model,
      input: context ? [
        { role: "user", content: [{ type: "input_text", text: "CONTEXT\n" + context }] },
        { role: "user", content: [{ type: "input_text", text: "TASK\n" + String(prompt || "") }] }
      ] : String(prompt || ""),
      max_output_tokens: maxOutputTokens,
      store: false
    };
    if (instructions) body.instructions = instructions;
    if (effort && effort !== "provider-default") body.reasoning = { effort };
    if (promptCacheKey) body.prompt_cache_key = promptCacheKey;
    const started = Date.now();
    const data = await fetchJson({
      provider: "xai", operation: "generate", url: BASE + "/responses",
      headers: { Authorization: "Bearer " + apiKey }, body, timeoutMs
    });
    const usage = data.usage || {};
    const cached = usage.input_tokens_details?.cached_tokens || 0;
    const output = usage.output_tokens || 0;
    const reasoning = usage.output_tokens_details?.reasoning_tokens ?? null;
    const ticks = Number(usage.cost_in_usd_ticks);
    return {
      text: typeof data.output_text === "string" ? data.output_text : extractResponseText(data.output),
      status: data.status || "completed",
      responseId: data.id || null,
      latencyMs: Date.now() - started,
      usage: normalizeUsage({
        inputTokens: usage.input_tokens || 0,
        cachedInputTokens: cached,
        uncachedInputTokens: Math.max(0, (usage.input_tokens || 0) - cached),
        outputTokens: output,
        visibleOutputTokens: reasoning == null ? null : Math.max(0, output - reasoning),
        reasoningTokens: reasoning,
        totalTokens: usage.total_tokens,
        providerCostUsd: Number.isFinite(ticks) ? ticks / 1e10 : null
      })
    };
  }
};
function requireKey(apiKey) {
  if (!apiKey) throw new Error("XAI_API_KEY is not configured.");
}
