import { extractResponseText, fetchJson, normalizeUsage } from "./base.mjs";

const BASE = "https://api.openai.com/v1";

export const openaiAdapter = {
  provider: "openai",
  supportsExactTokenCount: true,

  async countTokens({ apiKey, model, prompt, context = "", instructions = "", timeoutMs }) {
    requireKey(apiKey);
    const data = await fetchJson({
      provider: "openai", operation: "count_tokens", url: BASE + "/responses/input_tokens",
      headers: { Authorization: "Bearer " + apiKey },
      body: {
        model,
        input: buildInput(prompt, context),
        ...(instructions ? { instructions } : {})
      },
      timeoutMs
    });
    return { inputTokens: data.input_tokens || 0, method: "provider-exact" };
  },

  async generate({ apiKey, model, prompt, context = "", instructions = "", effort = "medium",
    maxOutputTokens = 4096, promptCacheKey = null, timeoutMs }) {
    requireKey(apiKey);
    const body = {
      model,
      input: buildInput(prompt, context),
      max_output_tokens: maxOutputTokens,
      store: false
    };
    if (instructions) body.instructions = instructions;
    if (effort && effort !== "provider-default") body.reasoning = { effort };
    if (promptCacheKey) body.prompt_cache_key = promptCacheKey;
    const started = Date.now();
    const data = await fetchJson({
      provider: "openai", operation: "generate", url: BASE + "/responses",
      headers: { Authorization: "Bearer " + apiKey }, body, timeoutMs
    });
    const usage = data.usage || {};
    const reasoning = usage.output_tokens_details?.reasoning_tokens || 0;
    const output = usage.output_tokens || 0;
    const cached = usage.input_tokens_details?.cached_tokens || 0;
    const cacheWrite = usage.input_tokens_details?.cache_write_tokens || 0;
    return {
      text: typeof data.output_text === "string" ? data.output_text : extractResponseText(data.output),
      status: data.status || "completed",
      responseId: data.id || null,
      latencyMs: Date.now() - started,
      usage: normalizeUsage({
        inputTokens: usage.input_tokens || 0,
        cachedInputTokens: cached,
        cacheWriteTokens: cacheWrite,
        uncachedInputTokens: Math.max(0, (usage.input_tokens || 0) - cached - cacheWrite),
        outputTokens: output,
        visibleOutputTokens: Math.max(0, output - reasoning),
        reasoningTokens: reasoning,
        totalTokens: usage.total_tokens
      })
    };
  }
};

export async function countOpenAIInput(args) {
  return openaiAdapter.countTokens(args);
}
export async function generateOpenAI(args) {
  return openaiAdapter.generate(args);
}

function buildInput(prompt, context) {
  if (!context) return String(prompt || "");
  return [
    { role: "user", content: [{ type: "input_text", text: "CONTEXT\n" + String(context) }] },
    { role: "user", content: [{ type: "input_text", text: "TASK\n" + String(prompt || "") }] }
  ];
}
function requireKey(apiKey) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
}
