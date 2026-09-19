export function resolvePricing(model, inputTokens, cacheTtl = "5m") {
  const base = model.pricing || {};
  const long = base.longContext;
  const inLongContext = Boolean(long && inputTokens > long.thresholdTokens);
  let inputUsdPerM = base.inputUsdPerM;
  let cachedInputUsdPerM = base.cachedInputUsdPerM ?? inputUsdPerM;
  let outputUsdPerM = base.outputUsdPerM;
  let cacheWriteUsdPerM = cacheTtl === "1h"
    ? base.cacheWrite1hUsdPerM
    : base.cacheWrite5mUsdPerM ?? base.cacheWriteUsdPerM;

  if (inLongContext) {
    if (long.inputUsdPerM != null) inputUsdPerM = long.inputUsdPerM;
    else if (long.inputMultiplier) inputUsdPerM *= long.inputMultiplier;
    if (long.cachedInputUsdPerM != null) cachedInputUsdPerM = long.cachedInputUsdPerM;
    else if (long.inputMultiplier) cachedInputUsdPerM *= long.inputMultiplier;
    if (long.outputUsdPerM != null) outputUsdPerM = long.outputUsdPerM;
    else if (long.outputMultiplier) outputUsdPerM *= long.outputMultiplier;
    if (cacheWriteUsdPerM != null && long.inputMultiplier) cacheWriteUsdPerM *= long.inputMultiplier;
  }
  return { inputUsdPerM, cachedInputUsdPerM, cacheWriteUsdPerM, outputUsdPerM, inLongContext,
    longContextThreshold: long?.thresholdTokens || null };
}

export function estimateRequestCost({
  model, inputTokens, tokenBudget, cachedInputTokens = 0, cacheWriteTokens = 0, percentile = "p90", cacheTtl = "5m"
}) {
  const rates = resolvePricing(model, inputTokens, cacheTtl);
  const cached = Math.min(Math.max(0, cachedInputTokens), inputTokens);
  const writes = Math.min(Math.max(0, cacheWriteTokens), Math.max(0, inputTokens - cached));
  const uncached = Math.max(0, inputTokens - cached - writes);
  const writeRate = rates.cacheWriteUsdPerM ?? rates.inputUsdPerM;
  const billedOutput = tokenBudget.billedOutput?.[percentile] ?? tokenBudget.billedOutput?.p90 ?? 0;
  const inputCost = (uncached / 1000000) * rates.inputUsdPerM +
    (cached / 1000000) * rates.cachedInputUsdPerM + (writes / 1000000) * writeRate;
  const outputCost = (billedOutput / 1000000) * rates.outputUsdPerM;
  return { totalUsd: round6(inputCost + outputCost), inputUsd: round6(inputCost), outputUsd: round6(outputCost),
    rates, percentile };
}

export function estimateCostEnvelope({
  model,
  inputTokens,
  tokenBudget,
  percentile = "p90",
  cacheTtl = "5m"
}) {
  const expected = estimateRequestCost({ model, inputTokens, tokenBudget, percentile, cacheTtl });
  const rates = resolvePricing(model, inputTokens, cacheTtl);
  const hasWriteSurcharge = rates.cacheWriteUsdPerM != null;
  const coldCacheCeiling = hasWriteSurcharge
    ? estimateRequestCost({
        model,
        inputTokens,
        tokenBudget,
        cacheWriteTokens: inputTokens,
        percentile,
        cacheTtl
      })
    : expected;
  return {
    expected,
    coldCacheCeiling: coldCacheCeiling.totalUsd > expected.totalUsd ? coldCacheCeiling : expected
  };
}

export function calculateActualCost(model, usage = {}, options = {}) {
  if (Number.isFinite(usage.providerCostUsd)) {
    return { totalUsd: round6(usage.providerCostUsd), source: "provider-reported" };
  }
  const totalInput = Math.max(0, usage.inputTokens || 0);
  const cached = Math.min(Math.max(0, usage.cachedInputTokens || 0), totalInput);
  const writes = Math.min(Math.max(0, usage.cacheWriteTokens || 0), Math.max(0, totalInput - cached));
  const uncached = Number.isFinite(usage.uncachedInputTokens)
    ? Math.max(0, usage.uncachedInputTokens)
    : Math.max(0, totalInput - cached - writes);
  const rates = resolvePricing(model, totalInput, options.cacheTtl || "5m");
  const writeRate = rates.cacheWriteUsdPerM ?? rates.inputUsdPerM;
  const inputCost = (uncached / 1000000) * rates.inputUsdPerM +
    (cached / 1000000) * rates.cachedInputUsdPerM + (writes / 1000000) * writeRate;
  const outputCost = ((usage.outputTokens || 0) / 1000000) * rates.outputUsdPerM;
  return { totalUsd: round6(inputCost + outputCost), source: "normalized-usage", rates };
}
export function round6(value) { return Math.round(value * 1000000) / 1000000; }
