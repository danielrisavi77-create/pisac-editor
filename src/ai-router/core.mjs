export { analyzeTaskV2, clamp } from "./classifier.mjs";
export { optimizeContext, roughInputTokens } from "./context.mjs";
export { predictTokenBudgetV2 } from "./predictor.mjs";
export { estimateRequestCost, estimateCostEnvelope, calculateActualCost, resolvePricing } from "./pricing.mjs";
export { generateCandidates } from "./router.mjs";
export { PROFILES_V2 as PROFILES, normalizeBudget } from "./budget.mjs";

import { analyzeTaskV2 } from "./classifier.mjs";
import { predictTokenBudgetV2 } from "./predictor.mjs";
import { estimateRequestCost } from "./pricing.mjs";
import { generateCandidates } from "./router.mjs";

export function analyzeTask(args) {
  return analyzeTaskV2({ ...args, profile: args?.profile === "standard" ? "balanced" : args?.profile });
}

export function predictTokenBudget({ inputTokens, analysis, desiredOutputTokens, effort = "medium", model = null }) {
  const fallbackModel = model || { pricing: { outputIncludesReasoning: true }, maxOutputTokens: 128000 };
  const result = predictTokenBudgetV2({ inputTokens, analysis, desiredOutputTokens, effort, model: fallbackModel });
  return {
    visibleOutput: result.visibleOutput,
    reasoning: result.reasoning,
    billedOutput: result.billedOutput,
    totalBilledOutput: result.billedOutput,
    source: result.source
  };
}

export function estimateCostUsd(model, inputTokens, tokenBudget) {
  const normalizedModel = model.pricing ? model : {
    ...model,
    pricing: {
      inputUsdPerM: model.inputUsdPerM,
      cachedInputUsdPerM: model.cachedInputUsdPerM,
      outputUsdPerM: model.outputUsdPerM,
      outputIncludesReasoning: true
    }
  };
  const normalizedBudget = tokenBudget.billedOutput ? tokenBudget : {
    ...tokenBudget,
    billedOutput: tokenBudget.totalBilledOutput
  };
  return estimateRequestCost({ model: normalizedModel, inputTokens, tokenBudget: normalizedBudget }).totalUsd;
}

export function routeModels({ catalog, inputTokens, analysis, profile = "balanced", desiredOutputTokens, budget = {} }) {
  const registry = catalog.map((model) => model.pricing ? model : ({
    ...model,
    capabilityRank: model.capabilityRank || model.tier || 1,
    supportsTools: model.supportsTools ?? true,
    supportsStructuredOutput: model.supportsStructuredOutput ?? true,
    reasoningModes: model.supportsReasoningEffort ? ["low", "medium", "high"] : ["provider-default"],
    pricing: {
      inputUsdPerM: model.inputUsdPerM,
      cachedInputUsdPerM: model.cachedInputUsdPerM,
      outputUsdPerM: model.outputUsdPerM,
      outputIncludesReasoning: true
    }
  }));
  const routing = generateCandidates({
    registry, inputTokens, analysis, profile: profile === "standard" ? "balanced" : profile,
    desiredOutputTokens, budget
  });
  const adapt = (candidate) => candidate ? ({
    ...candidate,
    estimatedCostUsd: candidate.estimatedCost.totalUsd,
    tokenBudget: { ...candidate.tokenBudget, totalBilledOutput: candidate.tokenBudget.billedOutput }
  }) : null;
  return {
    ...routing,
    candidates: routing.candidates.map(adapt),
    recommended: adapt(routing.recommended),
    maxEscalations: routing.budget.maxEscalations
  };
}
