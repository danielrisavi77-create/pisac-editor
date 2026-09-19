// Bootstrap catalog. Prices are USD per 1M text tokens and should be refreshed regularly.
// Add or override models at runtime with AI_ROUTER_CATALOG_JSON.
export const DEFAULT_CATALOG = [
  {
    provider: "openai",
    model: "gpt-5.6-luna",
    tier: 1,
    inputUsdPerM: 0.20,
    outputUsdPerM: 1.20,
    contextWindow: 1050000,
    maxOutputTokens: 128000,
    supportsReasoningEffort: true
  },
  {
    provider: "openai",
    model: "gpt-5.6-terra",
    tier: 2,
    inputUsdPerM: 2.00,
    outputUsdPerM: 12.00,
    contextWindow: 1050000,
    maxOutputTokens: 128000,
    supportsReasoningEffort: true
  },
  {
    provider: "openai",
    model: "gpt-5.6-sol",
    tier: 3,
    inputUsdPerM: 4.00,
    outputUsdPerM: 20.00,
    contextWindow: 1050000,
    maxOutputTokens: 128000,
    supportsReasoningEffort: true
  }
];

export function loadCatalog(env = process.env) {
  if (!env.AI_ROUTER_CATALOG_JSON) return DEFAULT_CATALOG;
  let parsed;
  try {
    parsed = JSON.parse(env.AI_ROUTER_CATALOG_JSON);
  } catch {
    throw new Error("AI_ROUTER_CATALOG_JSON must be valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("AI_ROUTER_CATALOG_JSON must be a non-empty array.");
  }
  return parsed.map(validateModel);
}

function validateModel(model) {
  const required = [
    "provider", "model", "tier", "inputUsdPerM", "outputUsdPerM",
    "contextWindow", "maxOutputTokens"
  ];
  for (const key of required) {
    if (model[key] === undefined || model[key] === null) {
      throw new Error("Model catalog entry is missing " + key + ".");
    }
  }
  return { supportsReasoningEffort: false, ...model };
}
