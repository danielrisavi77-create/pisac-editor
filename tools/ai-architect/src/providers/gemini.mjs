import { fetchJson, normalizeUsage } from "./http.mjs";

export function createGeminiProvider(config = {}, runtime = {}) {
  const env = runtime.env || process.env;
  const fetchImpl = runtime.fetchImpl || globalThis.fetch;
  return {
    id: "gemini",
    available() {
      return config.enabled !== false && Boolean(env[config.keyEnv || "GEMINI_API_KEY"]);
    },
    async execute({ model, system, user, plan }) {
      const apiKey = env[config.keyEnv || "GEMINI_API_KEY"];
      if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
      const endpoint = config.endpointBase || "https://generativelanguage.googleapis.com/v1beta/models";
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          maxOutputTokens: plan?.outputBudgetTokens || 4096
        }
      };
      if (Number.isFinite(Number(plan?.temperature))) {
        body.generationConfig.temperature = Number(plan.temperature);
      }
      const json = await fetchJson(
        `${endpoint}/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        },
        { timeoutMs: plan?.budgets?.maxLatencyMs || 30000, fetchImpl }
      );
      const output = (json.candidates?.[0]?.content?.parts || [])
        .map((part) => part.text || "")
        .join("\n");
      return {
        provider: "gemini",
        requestedModel: model,
        actualModel: json.modelVersion || model,
        output,
        usage: normalizeUsage({
          inputTokens: json.usageMetadata?.promptTokenCount,
          outputTokens: json.usageMetadata?.candidatesTokenCount,
          totalTokens: json.usageMetadata?.totalTokenCount
        }),
        costUsd: null
      };
    }
  };
}
