export const QUALITY_BANDS = Object.freeze({
  1: "efficiency",
  2: "general",
  3: "advanced",
  4: "frontier",
  5: "specialist-frontier"
});

const common = {
  modalities: ["text"],
  supportsStructuredOutput: true,
  supportsImages: false,
  supportsFiles: false,
  supportsTools: true,
  pricingBasis: "per-1m-tokens"
};

export const DEFAULT_MODEL_REGISTRY = [
  {
    ...common,
    provider: "openai", model: "gpt-5.6-luna", displayName: "GPT-5.6 Luna",
    capabilityRank: 1, stability: "stable", latencyClass: "fast",
    contextWindow: 1050000, maxOutputTokens: 128000,
    reasoningModes: ["none", "low", "medium", "high", "xhigh", "max"],
    supportsImages: true, supportsFiles: true, supportsCaching: true, supportsTokenCounting: true,
    pricing: { inputUsdPerM: 0.20, cachedInputUsdPerM: 0.02, cacheWriteUsdPerM: 0.25, outputUsdPerM: 1.20, outputIncludesReasoning: true,
      longContext: { thresholdTokens: 272000, inputMultiplier: 2, outputMultiplier: 1.5 } },
    sourceCheckedAt: "2026-09-19"
  },
  {
    ...common,
    provider: "openai", model: "gpt-5.6-terra", displayName: "GPT-5.6 Terra",
    capabilityRank: 3, stability: "stable", latencyClass: "medium",
    contextWindow: 1050000, maxOutputTokens: 128000,
    reasoningModes: ["none", "low", "medium", "high", "xhigh", "max"],
    supportsImages: true, supportsFiles: true, supportsCaching: true, supportsTokenCounting: true,
    pricing: { inputUsdPerM: 2.00, cachedInputUsdPerM: 0.20, cacheWriteUsdPerM: 2.50, outputUsdPerM: 12.00, outputIncludesReasoning: true,
      longContext: { thresholdTokens: 272000, inputMultiplier: 2, outputMultiplier: 1.5 } },
    sourceCheckedAt: "2026-09-19"
  },
  {
    ...common,
    provider: "openai", model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol",
    capabilityRank: 4, stability: "stable", latencyClass: "medium",
    contextWindow: 1050000, maxOutputTokens: 128000,
    reasoningModes: ["none", "low", "medium", "high", "xhigh", "max"],
    supportsImages: true, supportsFiles: true, supportsCaching: true, supportsTokenCounting: true,
    pricing: { inputUsdPerM: 4.00, cachedInputUsdPerM: 0.40, cacheWriteUsdPerM: 5.00, outputUsdPerM: 20.00,
      outputIncludesReasoning: true, longContext: { thresholdTokens: 272000, inputMultiplier: 2, outputMultiplier: 1.5 } },
    sourceCheckedAt: "2026-09-19"
  },
  {
    ...common,
    provider: "openai", model: "gpt-6-astra", displayName: "GPT-6 Astra",
    capabilityRank: 5, stability: "stable", latencyClass: "slow",
    contextWindow: 1050000, maxOutputTokens: 128000,
    reasoningModes: ["low", "medium", "high", "xhigh", "max"],
    supportsImages: true, supportsFiles: true, supportsCaching: true, supportsTokenCounting: true,
    pricing: { inputUsdPerM: 10.00, cachedInputUsdPerM: 1.00, cacheWriteUsdPerM: 12.50, outputUsdPerM: 50.00,
      outputIncludesReasoning: true, longContext: { thresholdTokens: 272000, inputMultiplier: 2, outputMultiplier: 1.5 } },
    sourceCheckedAt: "2026-09-19"
  },
  {
    ...common,
    provider: "anthropic", model: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5",
    capabilityRank: 2, stability: "stable", latencyClass: "fastest",
    contextWindow: 200000, maxOutputTokens: 64000, reasoningModes: ["none"],
    supportsImages: true, supportsFiles: true, supportsCaching: true, supportsTokenCounting: true,
    pricing: { inputUsdPerM: 1.00, cacheWrite5mUsdPerM: 1.25, cacheWrite1hUsdPerM: 2.00,
      cachedInputUsdPerM: 0.10, outputUsdPerM: 5.00, outputIncludesReasoning: true },
    sourceCheckedAt: "2026-09-19"
  },
  {
    ...common,
    provider: "anthropic", model: "claude-sonnet-5", displayName: "Claude Sonnet 5",
    capabilityRank: 4, stability: "stable", latencyClass: "fast",
    contextWindow: 1000000, maxOutputTokens: 128000, reasoningModes: ["low", "medium", "high", "xhigh", "max"],
    supportsImages: true, supportsFiles: true, supportsCaching: true, supportsTokenCounting: true,
    pricing: { inputUsdPerM: 2.00, cacheWrite5mUsdPerM: 2.50, cacheWrite1hUsdPerM: 4.00,
      cachedInputUsdPerM: 0.20, outputUsdPerM: 10.00, outputIncludesReasoning: true },
    sourceCheckedAt: "2026-09-19"
  },
  {
    ...common,
    provider: "anthropic", model: "claude-opus-5", displayName: "Claude Opus 5",
    capabilityRank: 4, stability: "stable", latencyClass: "medium",
    contextWindow: 1000000, maxOutputTokens: 128000, reasoningModes: ["low", "medium", "high", "xhigh", "max"],
    supportsImages: true, supportsFiles: true, supportsCaching: true, supportsTokenCounting: true,
    pricing: { inputUsdPerM: 5.00, cacheWrite5mUsdPerM: 6.25, cacheWrite1hUsdPerM: 10.00,
      cachedInputUsdPerM: 0.50, outputUsdPerM: 25.00, outputIncludesReasoning: true },
    sourceCheckedAt: "2026-09-19"
  },
  {
    ...common,
    provider: "anthropic", model: "claude-fable-5-1", displayName: "Claude Fable 5.1",
    capabilityRank: 5, stability: "stable", latencyClass: "slow",
    contextWindow: 1000000, maxOutputTokens: 128000, reasoningModes: ["low", "medium", "high", "xhigh", "max"],
    supportsImages: true, supportsFiles: true, supportsCaching: true, supportsTokenCounting: true,
    pricing: { inputUsdPerM: 10.00, cacheWrite5mUsdPerM: 12.50, cacheWrite1hUsdPerM: 20.00,
      cachedInputUsdPerM: 0.25, outputUsdPerM: 50.00, outputIncludesReasoning: true },
    sourceCheckedAt: "2026-09-19"
  },
  {
    ...common,
    provider: "google", model: "gemini-3.5-flash-lite", displayName: "Gemini 3.5 Flash-Lite",
    capabilityRank: 1, stability: "stable", latencyClass: "fastest",
    contextWindow: 1048576, maxOutputTokens: 65536, reasoningModes: ["minimal", "low", "medium", "high"],
    supportsImages: true, supportsFiles: true, supportsCaching: true, supportsTokenCounting: true,
    pricing: { inputUsdPerM: 0.30, cachedInputUsdPerM: 0.03, outputUsdPerM: 2.50, outputIncludesReasoning: true },
    sourceCheckedAt: "2026-09-19"
  },
  {
    ...common,
    provider: "google", model: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash",
    capabilityRank: 3, stability: "stable", latencyClass: "fast",
    contextWindow: 1048576, maxOutputTokens: 65536, reasoningModes: ["low", "medium", "high"],
    supportsImages: true, supportsFiles: true, supportsCaching: true, supportsTokenCounting: true,
    pricing: { inputUsdPerM: 0.75, cachedInputUsdPerM: 0.075, outputUsdPerM: 3.75, outputIncludesReasoning: true },
    sourceCheckedAt: "2026-09-19"
  },
  {
    ...common,
    provider: "google", model: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro Preview",
    capabilityRank: 4, stability: "preview", latencyClass: "medium",
    contextWindow: 1048576, maxOutputTokens: 65536, reasoningModes: ["low", "medium", "high"],
    supportsImages: true, supportsFiles: true, supportsCaching: true, supportsTokenCounting: true,
    pricing: { inputUsdPerM: 2.00, cachedInputUsdPerM: 0.20, outputUsdPerM: 12.00, outputIncludesReasoning: true,
      longContext: { thresholdTokens: 200000, inputUsdPerM: 4.00, cachedInputUsdPerM: 0.40, outputUsdPerM: 18.00 } },
    sourceCheckedAt: "2026-09-19"
  },
  {
    ...common,
    provider: "xai", model: "grok-4.6", displayName: "Grok 4.6",
    capabilityRank: 4, stability: "stable", latencyClass: "medium",
    contextWindow: 500000, maxOutputTokens: 128000, reasoningModes: ["low", "medium", "high", "xhigh"],
    supportsImages: true, supportsFiles: false, supportsCaching: true, supportsTokenCounting: false,
    pricing: { inputUsdPerM: 2.00, cachedInputUsdPerM: 0.50, outputUsdPerM: 6.00, outputIncludesReasoning: true,
      longContext: { thresholdTokens: 200000, inputUsdPerM: 4.00, cachedInputUsdPerM: 1.00, outputUsdPerM: 12.00 } },
    sourceCheckedAt: "2026-09-19"
  }
];

export function loadRegistry(env = process.env) {
  if (!env.AI_ROUTER_CATALOG_JSON) return DEFAULT_MODEL_REGISTRY.map(normalizeModel);
  let parsed;
  try { parsed = JSON.parse(env.AI_ROUTER_CATALOG_JSON); }
  catch { throw new Error("AI_ROUTER_CATALOG_JSON must be valid JSON."); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("AI_ROUTER_CATALOG_JSON must be a non-empty array.");
  return parsed.map(normalizeModel);
}

export function normalizeModel(model) {
  for (const key of ["provider", "model", "capabilityRank", "contextWindow", "maxOutputTokens", "pricing"]) {
    if (model?.[key] == null) throw new Error("Model registry entry is missing " + key + ".");
  }
  if (model.pricing?.inputUsdPerM == null) throw new Error("Model registry entry is missing pricing.inputUsdPerM.");
  if (model.pricing?.outputUsdPerM == null) throw new Error("Model registry entry is missing pricing.outputUsdPerM.");
  return {
    stability: "stable", latencyClass: "medium", reasoningModes: ["provider-default"],
    supportsTools: false, supportsStructuredOutput: false, supportsCaching: false, supportsTokenCounting: false,
    ...model, qualityBand: QUALITY_BANDS[model.capabilityRank] || "custom"
  };
}

export function providerConfigured(provider, env = process.env) {
  return Boolean({
    openai: env.OPENAI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    google: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
    xai: env.XAI_API_KEY
  }[provider]);
}
