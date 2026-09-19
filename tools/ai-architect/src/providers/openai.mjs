import { fetchJson, normalizeUsage } from "./http.mjs";

function responseText(json) {
  if (typeof json.output_text === "string") return json.output_text;
  const chunks = [];
  for (const item of json.output || []) {
    for (const part of item.content || []) {
      if (typeof part.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n");
}

export function createOpenAIProvider(config = {}, runtime = {}) {
  const env = runtime.env || process.env;
  const fetchImpl = runtime.fetchImpl || globalThis.fetch;
  return {
    id: "openai",
    available() {
      return Boolean(env[config.keyEnv || "OPENAI_API_KEY"]);
    },
    async execute({ model, system, user, plan }) {
      const apiKey = env[config.keyEnv || "OPENAI_API_KEY"];
      if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
      const body = {
        model,
        instructions: system,
        input: user
      };
      if (plan?.reasoning && plan.reasoning !== "none") {
        body.reasoning = { effort: plan.reasoning };
      }
      const json = await fetchJson(
        config.endpoint || "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        },
        { timeoutMs: plan?.budgets?.maxLatencyMs || 30000, fetchImpl }
      );
      return {
        provider: "openai",
        requestedModel: model,
        actualModel: json.model || model,
        output: responseText(json),
        usage: normalizeUsage({
          inputTokens: json.usage?.input_tokens,
          outputTokens: json.usage?.output_tokens,
          totalTokens: json.usage?.total_tokens
        }),
        costUsd: null
      };
    }
  };
}
