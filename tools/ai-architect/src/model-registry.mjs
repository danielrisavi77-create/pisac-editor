export const CATALOG_VERSION = "2026-09-19";

const common = Object.freeze({
  modalities:["text"],
  supportsStructuredOutput:true,
  supportsImages:false,
  supportsFiles:false,
  supportsTools:true,
  pricingBasis:"per-1m-tokens"
});

const openaiLongContext = Object.freeze({
  thresholdTokens:272000,
  inputMultiplier:2,
  cachedInputMultiplier:2,
  cacheWriteMultiplier:2,
  outputMultiplier:1.5
});

export const MODEL_REGISTRY = Object.freeze([
  {
    ...common,
    id:"openai:gpt-5.6-luna",
    provider:"openai",
    model:"gpt-5.6-luna",
    displayName:"GPT-5.6 Luna",
    capabilityRank:1,
    stability:"stable",
    latencyClass:"fast",
    contextWindow:1050000,
    maxOutputTokens:128000,
    reasoningModes:["none","low","medium","high","xhigh","max"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:true,
    supportsTokenCounting:true,
    pricing:{
      inputUsdPerM:0.20,
      cachedInputUsdPerM:0.02,
      cacheWriteUsdPerM:0.25,
      outputUsdPerM:1.20,
      outputIncludesReasoning:true,
      longContext:openaiLongContext
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://developers.openai.com/api/docs/models/gpt-5.6-luna"
  },
  {
    ...common,
    id:"openai:gpt-5.6-terra",
    provider:"openai",
    model:"gpt-5.6-terra",
    displayName:"GPT-5.6 Terra",
    capabilityRank:3,
    stability:"stable",
    latencyClass:"medium",
    contextWindow:1050000,
    maxOutputTokens:128000,
    reasoningModes:["none","low","medium","high","xhigh","max"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:true,
    supportsTokenCounting:true,
    pricing:{
      inputUsdPerM:2.00,
      cachedInputUsdPerM:0.20,
      cacheWriteUsdPerM:2.50,
      outputUsdPerM:12.00,
      outputIncludesReasoning:true,
      longContext:openaiLongContext
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://developers.openai.com/api/docs/models/gpt-5.6-terra"
  },
  {
    ...common,
    id:"openai:gpt-5.6-sol",
    provider:"openai",
    model:"gpt-5.6-sol",
    displayName:"GPT-5.6 Sol",
    capabilityRank:4,
    stability:"stable",
    latencyClass:"medium",
    contextWindow:1050000,
    maxOutputTokens:128000,
    reasoningModes:["none","low","medium","high","xhigh","max"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:true,
    supportsTokenCounting:true,
    pricing:{
      inputUsdPerM:4.00,
      cachedInputUsdPerM:0.40,
      cacheWriteUsdPerM:5.00,
      outputUsdPerM:20.00,
      outputIncludesReasoning:true,
      longContext:openaiLongContext
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://developers.openai.com/api/docs/models/gpt-5.6-sol"
  },
  {
    ...common,
    id:"openai:gpt-6-astra",
    provider:"openai",
    model:"gpt-6-astra",
    displayName:"GPT-6 Astra",
    capabilityRank:5,
    stability:"stable",
    latencyClass:"slow",
    contextWindow:1050000,
    maxOutputTokens:128000,
    reasoningModes:["low","medium","high","xhigh","max"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:true,
    supportsTokenCounting:true,
    pricing:{
      inputUsdPerM:10.00,
      cachedInputUsdPerM:1.00,
      cacheWriteUsdPerM:12.50,
      outputUsdPerM:50.00,
      outputIncludesReasoning:true,
      longContext:openaiLongContext
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://developers.openai.com/api/docs/models/gpt-6-astra"
  },
  {
    ...common,
    id:"anthropic:claude-haiku-4-5-20251001",
    provider:"anthropic",
    model:"claude-haiku-4-5-20251001",
    displayName:"Claude Haiku 4.5",
    capabilityRank:2,
    stability:"stable",
    latencyClass:"fastest",
    contextWindow:200000,
    maxOutputTokens:64000,
    reasoningModes:["provider-default"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:true,
    supportsTokenCounting:true,
    pricing:{
      inputUsdPerM:1.00,
      cacheWrite5mUsdPerM:1.25,
      cacheWrite1hUsdPerM:2.00,
      cachedInputUsdPerM:0.10,
      outputUsdPerM:5.00,
      outputIncludesReasoning:true
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://platform.claude.com/docs/en/models/overview"
  },
  {
    ...common,
    id:"anthropic:claude-sonnet-5",
    provider:"anthropic",
    model:"claude-sonnet-5",
    displayName:"Claude Sonnet 5",
    capabilityRank:4,
    stability:"stable",
    latencyClass:"fast",
    contextWindow:1000000,
    maxOutputTokens:128000,
    reasoningModes:["low","medium","high","xhigh","max"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:true,
    supportsTokenCounting:true,
    pricing:{
      inputUsdPerM:2.00,
      cacheWrite5mUsdPerM:2.50,
      cacheWrite1hUsdPerM:4.00,
      cachedInputUsdPerM:0.20,
      outputUsdPerM:10.00,
      outputIncludesReasoning:true
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://platform.claude.com/docs/en/models/overview"
  },
  {
    ...common,
    id:"anthropic:claude-opus-5",
    provider:"anthropic",
    model:"claude-opus-5",
    displayName:"Claude Opus 5",
    capabilityRank:4,
    stability:"stable",
    latencyClass:"medium",
    contextWindow:1000000,
    maxOutputTokens:128000,
    reasoningModes:["low","medium","high","xhigh","max"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:true,
    supportsTokenCounting:true,
    pricing:{
      inputUsdPerM:5.00,
      cacheWrite5mUsdPerM:6.25,
      cacheWrite1hUsdPerM:10.00,
      cachedInputUsdPerM:0.50,
      outputUsdPerM:25.00,
      outputIncludesReasoning:true
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://platform.claude.com/docs/en/models/overview"
  },
  {
    ...common,
    id:"anthropic:claude-fable-5-1",
    provider:"anthropic",
    model:"claude-fable-5-1",
    displayName:"Claude Fable 5.1",
    capabilityRank:5,
    stability:"stable",
    latencyClass:"slow",
    contextWindow:1000000,
    maxOutputTokens:128000,
    reasoningModes:["low","medium","high","xhigh","max"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:true,
    supportsTokenCounting:true,
    pricing:{
      inputUsdPerM:10.00,
      cacheWrite5mUsdPerM:12.50,
      cacheWrite1hUsdPerM:20.00,
      cachedInputUsdPerM:0.25,
      outputUsdPerM:50.00,
      outputIncludesReasoning:true
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://platform.claude.com/docs/en/models/fable-5-1/overview"
  },
  {
    ...common,
    id:"gemini:gemini-3.5-flash-lite",
    provider:"gemini",
    model:"gemini-3.5-flash-lite",
    displayName:"Gemini 3.5 Flash-Lite",
    capabilityRank:1,
    stability:"stable",
    latencyClass:"fastest",
    contextWindow:1048576,
    maxOutputTokens:65536,
    reasoningModes:["minimal","low","medium","high"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:true,
    supportsTokenCounting:true,
    pricing:{
      inputUsdPerM:0.30,
      cachedInputUsdPerM:0.03,
      outputUsdPerM:2.50,
      outputIncludesReasoning:true
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite"
  },
  {
    ...common,
    id:"gemini:gemini-3.8-flash",
    provider:"gemini",
    model:"gemini-3.8-flash",
    displayName:"Gemini 3.8 Flash",
    capabilityRank:3,
    stability:"stable",
    latencyClass:"fast",
    contextWindow:1048576,
    maxOutputTokens:65536,
    reasoningModes:["low","medium","high"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:true,
    supportsTokenCounting:true,
    pricing:{
      inputUsdPerM:0.75,
      cachedInputUsdPerM:0.075,
      outputUsdPerM:3.75,
      outputIncludesReasoning:true,
      priceValidThrough:"2026-12-31"
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash"
  },
  {
    ...common,
    id:"gemini:gemini-3.1-pro-preview",
    provider:"gemini",
    model:"gemini-3.1-pro-preview",
    displayName:"Gemini 3.1 Pro Preview",
    capabilityRank:4,
    stability:"preview",
    latencyClass:"medium",
    contextWindow:1048576,
    maxOutputTokens:65536,
    reasoningModes:["low","medium","high"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:true,
    supportsTokenCounting:true,
    pricing:{
      inputUsdPerM:2.00,
      cachedInputUsdPerM:0.20,
      outputUsdPerM:12.00,
      outputIncludesReasoning:true,
      longContext:{
        thresholdTokens:200000,
        inputUsdPerM:4.00,
        cachedInputUsdPerM:0.40,
        outputUsdPerM:18.00
      }
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://ai.google.dev/gemini-api/docs/generate-content/gemini-3"
  },
  {
    ...common,
    id:"xai:grok-4.6",
    provider:"xai",
    model:"grok-4.6",
    displayName:"Grok 4.6",
    capabilityRank:4,
    stability:"stable",
    latencyClass:"medium",
    contextWindow:500000,
    maxOutputTokens:null,
    applicationOutputCap:128000,
    reasoningModes:["low","medium","high","xhigh"],
    supportsImages:true,
    supportsFiles:false,
    supportsCaching:true,
    supportsTokenCounting:false,
    pricing:{
      inputUsdPerM:2.00,
      cachedInputUsdPerM:0.50,
      outputUsdPerM:6.00,
      outputIncludesReasoning:true,
      longContext:{
        thresholdTokens:200000,
        inputUsdPerM:4.00,
        cachedInputUsdPerM:1.00,
        outputUsdPerM:12.00
      }
    },
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://docs.x.ai/developers/models/grok-4.6"
  },
  {
    ...common,
    id:"openrouter:openrouter/auto",
    provider:"openrouter",
    model:"openrouter/auto",
    displayName:"OpenRouter Auto",
    capabilityRank:3,
    capabilitySource:"dynamic-router-heuristic",
    stability:"dynamic",
    latencyClass:"medium",
    contextWindow:2000000,
    maxOutputTokens:null,
    applicationOutputCap:128000,
    reasoningModes:["provider-default"],
    supportsImages:true,
    supportsFiles:true,
    supportsCaching:false,
    supportsTokenCounting:false,
    pricing:null,
    dynamicPricing:true,
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:"https://openrouter.ai/openrouter/auto"
  },
  {
    ...common,
    id:"local:local/mock",
    provider:"local",
    model:"local/mock",
    displayName:"Local Mock",
    capabilityRank:1,
    stability:"test-only",
    latencyClass:"fastest",
    contextWindow:100000,
    maxOutputTokens:10000,
    reasoningModes:["none"],
    supportsTools:false,
    supportsStructuredOutput:false,
    supportsCaching:false,
    supportsTokenCounting:false,
    pricing:{inputUsdPerM:0,cachedInputUsdPerM:0,outputUsdPerM:0,outputIncludesReasoning:true},
    sourceCheckedAt:CATALOG_VERSION,
    sourceUrl:null
  }
]);

const byId = new Map(MODEL_REGISTRY.map((model) => [model.id, model]));

export function getModel(id) {
  return byId.get(id) || null;
}

export function requireModel(id) {
  const model = getModel(id);
  if (!model) throw new Error(`Unknown canonical model registry id: ${id}`);
  return model;
}

export function resolveModelRefs(refs = []) {
  return refs.map(requireModel);
}

export function registryIds() {
  return [...byId.keys()];
}

export function validateModelRegistry() {
  const errors=[];
  const seen=new Set();
  for (const model of MODEL_REGISTRY) {
    if (!model.id || seen.has(model.id)) errors.push(`duplicate/missing id: ${model.id}`);
    seen.add(model.id);
    if (!model.provider || !model.model) errors.push(`${model.id}: provider/model required`);
    if (!Number.isFinite(Number(model.contextWindow)) || model.contextWindow <= 0) errors.push(`${model.id}: invalid contextWindow`);
    if (model.maxOutputTokens != null && (!Number.isFinite(Number(model.maxOutputTokens)) || model.maxOutputTokens <= 0)) errors.push(`${model.id}: invalid maxOutputTokens`);
    if (!model.dynamicPricing && model.provider !== "local") {
      if (!model.pricing || !Number.isFinite(Number(model.pricing.inputUsdPerM)) || !Number.isFinite(Number(model.pricing.outputUsdPerM))) {
        errors.push(`${model.id}: static models require numeric input/output pricing`);
      }
    }
  }
  return {valid:errors.length===0,errors,count:MODEL_REGISTRY.length,version:CATALOG_VERSION};
}
