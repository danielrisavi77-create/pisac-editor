import { PROFILES_V2, checkCandidateBudget, normalizeBudget } from "./budget.mjs";
import { predictTokenBudgetV2 } from "./predictor.mjs";
import { estimateCostEnvelope } from "./pricing.mjs";
import { estimateQuality } from "./quality.mjs";

const LATENCY_INDEX = { fastest: 1, fast: 2, medium: 3, slow: 4 };

export function generateCandidates({
  registry, inputTokens, analysis, profile = "balanced", budget: rawBudget = {}, desiredOutputTokens,
  calibration = {}, availableProviders = null, inputTokenCounts = {}
}) {
  const profileConfig = PROFILES_V2[profile] || PROFILES_V2.balanced;
  const budget = normalizeBudget(rawBudget, profile);
  const accepted = [];
  const rejected = [];

  for (const model of registry) {
    if (availableProviders && !availableProviders.includes(model.provider)) {
      rejected.push(reject(model, "provider_not_configured"));
      continue;
    }
    const capabilityReasons = capabilityRejections(model, analysis);
    if (capabilityReasons.length) {
      rejected.push({ provider: model.provider, model: model.model, reasons: capabilityReasons });
      continue;
    }
    for (const effort of chooseEfforts(model, analysis, profile)) {
      const modelKey = model.provider + "|" + model.model;
      const modelInputTokens = inputTokenCounts[modelKey] ?? inputTokens;
      const key = [analysis.taskType, model.provider, model.model, effort].join("|");
      const stats = calibration[key] || null;
      const tokenBudget = predictTokenBudgetV2({
        inputTokens: modelInputTokens, analysis, model, effort, desiredOutputTokens, calibration: stats
      });
      if (modelInputTokens + tokenBudget.billedOutput.p95 > model.contextWindow) {
        rejected.push({ provider: model.provider, model: model.model, effort, reasons: ["context_window_exceeded"] });
        continue;
      }
      if (tokenBudget.billedOutput.p95 > model.maxOutputTokens) {
        rejected.push({ provider: model.provider, model: model.model, effort, reasons: ["model_output_limit_exceeded"] });
        continue;
      }
      const quality = estimateQuality({ model, analysis, calibration: stats });
      const heuristicFloor = Math.max(profileConfig.heuristicCapabilityFloor, analysis.requiredCapabilityRank);
      if (quality.source === "heuristic" && quality.capabilityRank < heuristicFloor) {
        rejected.push({ provider: model.provider, model: model.model, effort, reasons: ["heuristic_capability_floor_not_met"] });
        continue;
      }
      const costEnvelope = estimateCostEnvelope({
        model,
        inputTokens: modelInputTokens,
        tokenBudget,
        percentile: "p90"
      });
      const estimatedCost = costEnvelope.expected;
      const estimatedBudgetCost = costEnvelope.coldCacheCeiling;
      const empiricalLatencyMs = stats?.sampleCount >= 20 ? Number(stats.medianLatencyMs || 0) || null : null;
      const candidate = {
        ...model, effort, inputTokens: modelInputTokens, tokenBudget, quality, empiricalLatencyMs,
        estimatedCost, estimatedBudgetCost,
        expectedVerificationCostUsd: 0,
        expectedRetryCostUsd: null,
        expectedEscalationCostUsd: null,
        expectedTotalCostUsd: null,
        qualityEstimateSource: quality.source,
        tokenEstimateSource: tokenBudget.source
      };
      const budgetReasons = checkCandidateBudget(candidate, budget);
      if (budgetReasons.length) {
        rejected.push({ provider: model.provider, model: model.model, effort, reasons: budgetReasons });
        continue;
      }
      accepted.push(candidate);
    }
  }

  enrichExpectedCosts(accepted);
  rankCandidates(accepted, profileConfig);
  return {
    candidates: accepted, rejected, recommended: accepted[0] || null, budget, profile: profileConfig,
    selectionMethod: accepted[0]?.quality?.successProbability != null
      ? "expected-cost-per-verified-success" : "transparent-heuristic-pareto",
    noCandidateReason: accepted.length ? null : summarizeRejections(rejected)
  };
}

function enrichExpectedCosts(candidates) {
  const effortRank = { "provider-default": 1, none: 0, minimal: 0.5, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
  for (const candidate of candidates) {
    if (candidate.quality.source !== "production-empirical") continue;
    const base = candidate.estimatedCost.totalUsd;
    const retryProbability = candidate.quality.needsRetryProbability;
    const escalationProbability = candidate.quality.needsEscalationProbability;
    candidate.expectedRetryCostUsd = retryProbability == null ? null : round6(base * retryProbability);
    const stronger = candidates
      .filter((other) => other !== candidate && (
        other.quality.capabilityRank > candidate.quality.capabilityRank ||
        (other.quality.capabilityRank === candidate.quality.capabilityRank &&
          (effortRank[other.effort] || 0) > (effortRank[candidate.effort] || 0))
      ))
      .sort((a, b) => a.estimatedCost.totalUsd - b.estimatedCost.totalUsd)[0] || null;
    candidate.expectedEscalationCostUsd = escalationProbability == null
      ? null
      : round6((stronger?.estimatedCost?.totalUsd || 0) * escalationProbability);
    const retryCost = candidate.expectedRetryCostUsd || 0;
    const escalationCost = candidate.expectedEscalationCostUsd || 0;
    candidate.expectedTotalCostUsd = round6(base + retryCost + escalationCost + (candidate.expectedVerificationCostUsd || 0));
    candidate.expectedCostPerSuccessfulTaskUsd = candidate.quality.successProbability > 0
      ? round6(candidate.expectedTotalCostUsd / candidate.quality.successProbability)
      : null;
  }
}

function rankCandidates(candidates, profile) {
  if (!candidates.length) return;
  const costBasis = (candidate) => candidate.expectedTotalCostUsd ?? candidate.estimatedCost.totalUsd;
  const minCost = Math.max(0.000001, Math.min(...candidates.map((candidate) => costBasis(candidate) || 0.000001)));
  const empiricalLatencies = candidates.map((c) => c.empiricalLatencyMs).filter((x) => Number.isFinite(x) && x > 0);
  const minLatency = empiricalLatencies.length ? Math.min(...empiricalLatencies) : null;
  for (const candidate of candidates) {
    const costNorm = Math.max(1, costBasis(candidate) / minCost);
    const latencyNorm = candidate.empiricalLatencyMs && minLatency
      ? candidate.empiricalLatencyMs / minLatency : (LATENCY_INDEX[candidate.latencyClass] || 3);
    let reliabilityNorm;
    if (candidate.quality.successProbability != null) {
      reliabilityNorm = 1 / Math.max(0.05, candidate.quality.successProbability);
    } else {
      const margin = Math.max(-1, candidate.quality.capabilityMargin || 0);
      const stabilityReserve = candidate.stability === "preview" ? 0.25 : 0;
      reliabilityNorm = Math.max(0.65, 1.20 - margin * 0.12 + stabilityReserve);
      candidate.expectedCostPerSuccessfulTaskUsd = null;
      candidate.heuristicReliabilityReserve = round3(reliabilityNorm);
    }
    candidate.selectionScore = round6(
      profile.costWeight * costNorm + profile.latencyWeight * latencyNorm + profile.reliabilityWeight * reliabilityNorm
    );
    candidate.selectionReason = {
      costNorm: round3(costNorm), latencyNorm: round3(latencyNorm),
      reliabilityNorm: round3(reliabilityNorm), qualitySource: candidate.quality.source
    };
  }
  candidates.sort((a, b) => a.selectionScore - b.selectionScore ||
    a.estimatedCost.totalUsd - b.estimatedCost.totalUsd ||
    b.quality.capabilityRank - a.quality.capabilityRank);
}

function capabilityRejections(model, analysis) {
  const r = [];
  const req = analysis.requiredCapabilities || {};
  if (req.tools && !model.supportsTools) r.push("tools_not_supported");
  if (req.structuredOutput && !model.supportsStructuredOutput) r.push("structured_output_not_supported");
  if (req.images && !model.supportsImages) r.push("images_not_supported");
  if (req.files && !model.supportsFiles) r.push("files_not_supported");
  return r;
}

function chooseEfforts(model, analysis, profile) {
  const modes = model.reasoningModes?.length ? model.reasoningModes : ["provider-default"];
  if (modes.includes("provider-default") && modes.length === 1) return ["provider-default"];
  const desired = analysis.reasoningNeed === "high"
    ? (profile === "critical" ? ["high", "xhigh", "max"] : ["high", "xhigh"])
    : analysis.reasoningNeed === "low" ? ["none", "minimal", "low", "medium"] : ["medium", "high"];
  const matched = desired.filter((x) => modes.includes(x));
  if (matched.length) return matched.slice(0, profile === "critical" ? 2 : 1);
  if (modes.includes("medium")) return ["medium"];
  if (modes.includes("high")) return ["high"];
  return [modes[0]];
}

function reject(model, reason) { return { provider: model.provider, model: model.model, reasons: [reason] }; }
function summarizeRejections(rejected) {
  const counts = {};
  for (const item of rejected) for (const reason of item.reasons || []) counts[reason] = (counts[reason] || 0) + 1;
  return { code: "NO_VALID_CANDIDATE", rejectionCounts: counts };
}
function round3(v) { return Math.round(v * 1000) / 1000; }
function round6(v) { return Math.round(v * 1000000) / 1000000; }
