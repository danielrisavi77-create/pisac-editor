import { fetchJson, normalizeUsage } from "./base.mjs";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const geminiAdapter = {
  provider: "google",
  supportsExactTokenCount: true,

  async countTokens({ apiKey, model, prompt, context = "", instructions = "", timeoutMs }) {
    requireKey(apiKey);
    const payload = buildPayload({ prompt, context, instructions });
    const data = await fetchJson({
      provider: "google", operation: "count_tokens",
      url: BASE + "/" + encodeURIComponent(model) + ":countTokens?key=" + encodeURIComponent(apiKey),
      body: payload, timeoutMs
    });
    return { inputTokens: data.totalTokens || 0, cachedInputTokens: data.cachedContentTokenCount || 0, method: "provider-exact" };
  },

  async generate({ apiKey, model, prompt, context = "", instructions = "", effort = "provider-default",
    maxOutputTokens = 4096, timeoutMs }) {
    requireKey(apiKey);
    const body = buildPayload({ prompt, context, instructions });
    body.generationConfig = { maxOutputTokens };
    if (effort !== "provider-default") body.generationConfig.thinkingConfig = { thinkingLevel: String(effort).toLowerCase() };
    const started = Date.now();
    const data = await fetchJson({
      provider: "google", operation: "generate",
      url: BASE + "/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey),
      body, timeoutMs
    });
    const usage = data.usageMetadata || {};
    const visible = usage.candidatesTokenCount || 0;
    const reasoning = usage.thoughtsTokenCount || 0;
    const input = usage.promptTokenCount || 0;
    const cached = usage.cachedContentTokenCount || 0;
    return {
      text: extractText(data),
      status: data.candidates?.[0]?.finishReason || "completed",
      responseId: data.responseId || null,
      latencyMs: Date.now() - started,
      usage: normalizeUsage({
        inputTokens: input,
        uncachedInputTokens: Math.max(0, input - cached),
        cachedInputTokens: cached,
        outputTokens: visible + reasoning,
        visibleOutputTokens: visible,
        reasoningTokens: reasoning,
        toolTokens: usage.toolUsePromptTokenCount || 0,
        totalTokens: usage.totalTokenCount
      })
    };
  }
};

function buildPayload({ prompt, context, instructions }) {
  const body = {
    contents: [{ role: "user", parts: [{ text: (context ? "CONTEXT\n" + context + "\n\n" : "") + "TASK\n" + String(prompt || "") }] }]
  };
  if (instructions) body.systemInstruction = { parts: [{ text: instructions }] };
  return body;
}
function extractText(data) {
  return (data.candidates?.[0]?.content?.parts || []).filter((x) => typeof x.text === "string" && !x.thought).map((x) => x.text).join("\n");
}
function requireKey(apiKey) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
}
