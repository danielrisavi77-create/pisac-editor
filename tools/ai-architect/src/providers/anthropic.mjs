import { fetchJson, normalizeUsage } from "./http.mjs";

export function createAnthropicProvider(config = {}, runtime = {}) {
  const env = runtime.env || process.env;
  const fetchImpl = runtime.fetchImpl || globalThis.fetch;
  return {
    id: "anthropic",
    available() {
      return Boolean(env[config.keyEnv || "ANTHROPIC_API_KEY"]);
    },
    async execute({ model, system, user, plan }) {
      const apiKey = env[config.keyEnv || "ANTHROPIC_API_KEY"];
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
      const json = await fetchJson(
        config.endpoint || "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": config.apiVersion || "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model,
            max_tokens: plan?.outputBudgetTokens || 4096,
            system,
            messages: [{ role: "user", content: user }]
          })
        },
        { timeoutMs: plan?.budgets?.maxLatencyMs || 30000, fetchImpl }
      );
      return {
        provider: "anthropic",
        requestedModel: model,
        actualModel: json.model || model,
        output: (json.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n"),
        usage: normalizeUsage({
          inputTokens: json.usage?.input_tokens,
          outputTokens: json.usage?.output_tokens
        }),
        costUsd: null
      };
    }
  };
}
