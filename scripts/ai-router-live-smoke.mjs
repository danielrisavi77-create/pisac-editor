import { DEFAULT_ADAPTERS, getProviderApiKey } from "../src/ai-router/providers/index.mjs";
import { loadRegistry } from "../src/ai-router/registry.mjs";

const provider = process.env.AI_ROUTER_LIVE_PROVIDER;
if (!provider || !DEFAULT_ADAPTERS[provider]) throw new Error("Set AI_ROUTER_LIVE_PROVIDER to a supported provider.");
const apiKey = getProviderApiKey(provider, process.env);
if (!apiKey) throw new Error("The selected provider secret is not configured.");
const model = loadRegistry(process.env).find((item) => item.provider === provider);
if (!model) throw new Error("No registry model exists for selected provider.");
const adapter = DEFAULT_ADAPTERS[provider];
const prompt = "Return exactly: router-live-ok";
let count = { method: "heuristic-required", inputTokens: null };
if (adapter.supportsExactTokenCount) {
  count = await adapter.countTokens({ apiKey, model: model.model, prompt, timeoutMs: 30000 });
}
const response = await adapter.generate({
  apiKey, model: model.model, prompt,
  effort: model.reasoningModes.includes("low") ? "low" : "provider-default",
  maxOutputTokens: 128, timeoutMs: 30000
});
console.log(JSON.stringify({
  provider, model: model.model, countMethod: count.method, inputTokens: count.inputTokens,
  outputTokens: response.usage.outputTokens, latencyMs: response.latencyMs,
  providerCostUsd: response.usage.providerCostUsd, textMatched: response.text.includes("router-live-ok")
}, null, 2));
