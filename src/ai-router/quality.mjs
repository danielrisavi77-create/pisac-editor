export function estimateQuality({ model, analysis, calibration = null }) {
  if ((calibration?.initialSampleCount || 0) >= 30 && calibration.successRate != null) {
    return {
      source: "production-empirical",
      successProbability: clamp(Number(calibration.successRate), 0, 1),
      firstPassSuccessProbability: nullableProbability(calibration.firstPassSuccessRate),
      needsRetryProbability: nullableProbability(calibration.retryRate),
      needsEscalationProbability: nullableProbability(calibration.escalationRate),
      expectedQuality: nullableProbability(calibration.expectedQualityScore),
      sampleCount: calibration.initialSampleCount,
      capabilityRank: model.capabilityRank,
      capabilityMargin: model.capabilityRank - analysis.requiredCapabilityRank,
      meetsHeuristicFloor: model.capabilityRank >= analysis.requiredCapabilityRank
    };
  }
  const taskAdjustment = heuristicTaskAdjustment(model, analysis.taskType);
  const effectiveRank = clamp(model.capabilityRank + taskAdjustment, 1, 5);
  return {
    source: "heuristic",
    successProbability: null,
    firstPassSuccessProbability: null,
    needsRetryProbability: null,
    needsEscalationProbability: null,
    expectedQuality: null,
    sampleCount: 0,
    capabilityRank: effectiveRank,
    registryCapabilityRank: model.capabilityRank,
    capabilityMargin: effectiveRank - analysis.requiredCapabilityRank,
    meetsHeuristicFloor: effectiveRank >= analysis.requiredCapabilityRank,
    note: "No probability is asserted until enough verified production samples exist."
  };
}

function heuristicTaskAdjustment(model, taskType) {
  if (model.model === "gemini-3.5-flash-lite" && ["repository_analysis", "academic_analysis"].includes(taskType)) return -1;
  if (model.model === "claude-haiku-4-5-20251001" && taskType === "repository_analysis") return -0.5;
  if (model.model === "claude-fable-5-1" && ["repository_analysis", "architecture_design", "academic_analysis"].includes(taskType)) return 0.25;
  return 0;
}
function nullableProbability(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return clamp(Number(value), 0, 1);
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
