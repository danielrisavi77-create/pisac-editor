import { fetchJson, normalizeUsage } from "./http.mjs";

export function createOpenRouterProvider(config = {}, runtime = {}) {
  const env = runtime.env || process.env;
  const fetchImpl = runtime.fetchImpl || globalThis.fetch;
  return {
    id: "openrouter",
    available() {
      return Boolean(env[config.keyEnv || "OPENROUTER_API_KEY"]);
    },
    async execute({ model, system, user, plan }) {
      const apiKey = env[config.keyEnv || "OPENROUTER_API_KEY"];
      if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");
      const json = await fetchJson(
        config.endpoint || "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": env.AI_ARCHITECT_SITE_URL || "https://github.com/danielrisavi77-create/pisac-editor",
            "X-Title": env.AI_ARCHITECT_APP_NAME || "AI Architect"
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user }
            ]
          })
        },
        { timeoutMs: plan?.budgets?.maxLatencyMs || 30000, fetchImpl }
      );
      return {
        provider: "openrouter",
        requestedModel: model,
        actualModel: json.model || model,
        output: json.choices?.[0]?.message?.content ?? "",
        usage: normalizeUsage({
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens,
          totalTokens: json.usage?.total_tokens
        }),
        costUsd: Number.isFinite(Number(json.usage?.cost)) ? Number(json.usage.cost) : null
      };
    }
  };
}
