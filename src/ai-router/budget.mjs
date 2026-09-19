export const PROFILES_V2 = Object.freeze({
  fast: { costWeight: 0.35, latencyWeight: 1.0, reliabilityWeight: 0.45,
    heuristicCapabilityFloor: 1, verification: "conditional", maxRetries: 1, maxEscalations: 0 },
  economy: { costWeight: 1.0, latencyWeight: 0.20, reliabilityWeight: 0.55,
    heuristicCapabilityFloor: 1, verification: "conditional", maxRetries: 1, maxEscalations: 1 },
  balanced: { costWeight: 0.70, latencyWeight: 0.40, reliabilityWeight: 0.85,
    heuristicCapabilityFloor: 2, verification: "conditional", maxRetries: 1, maxEscalations: 1 },
  quality: { costWeight: 0.35, latencyWeight: 0.20, reliabilityWeight: 1.0,
    heuristicCapabilityFloor: 3, verification: "required", maxRetries: 1, maxEscalations: 1 },
  critical: { costWeight: 0.15, latencyWeight: 0.10, reliabilityWeight: 1.25,
    heuristicCapabilityFloor: 4, verification: "required", maxRetries: 2, maxEscalations: 2 }
});

export function normalizeBudget(input = {}, profileName = "balanced") {
  const profile = PROFILES_V2[profileName] || PROFILES_V2.balanced;
  return {
    maxCostUsd: finiteOrNull(input.maxCostUsd), maxInputTokens: finiteOrNull(input.maxInputTokens),
    maxOutputTokens: finiteOrNull(input.maxOutputTokens), maxTotalTokens: finiteOrNull(input.maxTotalTokens),
    maxLatencyMs: finiteOrNull(input.maxLatencyMs), minQuality: finiteOrNull(input.minQuality),
    requireEmpiricalQuality: Boolean(input.requireEmpiricalQuality),
    maxRetries: integerOr(input.maxRetries, profile.maxRetries),
    maxEscalations: integerOr(input.maxEscalations, profile.maxEscalations),
    allowProviders: arrayOrNull(input.allowProviders), denyProviders: arrayOrNull(input.denyProviders),
    allowPreviewModels: input.allowPreviewModels !== false,
    allowUnverifiedLatency: input.allowUnverifiedLatency !== false
  };
}

export function checkCandidateBudget(candidate, budget) {
  const reasons = [];
  if (budget.allowProviders && !budget.allowProviders.includes(candidate.provider)) reasons.push("provider_not_allowed");
  if (budget.denyProviders?.includes(candidate.provider)) reasons.push("provider_denied");
  if (!budget.allowPreviewModels && candidate.stability === "preview") reasons.push("preview_model_denied");
  if (budget.maxCostUsd != null && (candidate.estimatedBudgetCost?.totalUsd ?? candidate.estimatedCost?.totalUsd) > budget.maxCostUsd) reasons.push("max_cost_exceeded");
  if (budget.maxInputTokens != null && candidate.inputTokens > budget.maxInputTokens) reasons.push("max_input_tokens_exceeded");
  if (budget.maxOutputTokens != null && candidate.tokenBudget.billedOutput.p95 > budget.maxOutputTokens) reasons.push("max_output_tokens_exceeded");
  if (budget.maxTotalTokens != null && candidate.inputTokens + candidate.tokenBudget.billedOutput.p95 > budget.maxTotalTokens) reasons.push("max_total_tokens_exceeded");
  if (budget.requireEmpiricalQuality && candidate.quality.source !== "production-empirical") reasons.push("empirical_quality_unavailable");
  if (budget.minQuality != null) {
    if (candidate.quality.successProbability == null) {
      reasons.push("min_quality_unverifiable");
    } else if (candidate.quality.successProbability < budget.minQuality) {
      reasons.push("min_quality_not_met");
    }
  }
  if (budget.maxLatencyMs != null) {
    if (candidate.empiricalLatencyMs == null && !budget.allowUnverifiedLatency) reasons.push("latency_unverifiable");
    if (candidate.empiricalLatencyMs != null && candidate.empiricalLatencyMs > budget.maxLatencyMs) reasons.push("max_latency_exceeded");
  }
  return reasons;
}
function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
function integerOr(value, fallback) { return Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback; }
function arrayOrNull(value) { return Array.isArray(value) && value.length ? [...new Set(value.map(String))] : null; }
