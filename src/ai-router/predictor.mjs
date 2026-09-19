const OUTPUT_RATIOS = {
  simple_qa: 0.22, summarization: 0.30, rewrite: 0.52, translation: 0.58,
  academic_writing: 0.62, academic_analysis: 0.48, citation_verification: 0.34,
  coding: 0.42, debugging: 0.34, repository_analysis: 0.46, architecture_design: 0.52,
  data_analysis: 0.38, extraction: 0.18, classification: 0.12, structured_output: 0.28,
  creative_writing: 0.65, general: 0.34
};
const REASONING_FACTORS = {
  "provider-default": 0.18, none: 0, minimal: 0.04, low: 0.10, medium: 0.22, high: 0.38, xhigh: 0.52, max: 0.68
};

export function predictTokenBudgetV2({
  inputTokens, analysis, model, effort = "provider-default", desiredOutputTokens, calibration = null
}) {
  if (calibration?.sampleCount >= 20 && calibration.outputMedian != null && calibration.outputP90 != null) {
    const visibleP50 = Math.max(1, Math.round(calibration.outputMedian));
    const visibleP90 = Math.max(visibleP50, Math.round(calibration.outputP90));
    const reasoningP50 = Math.max(0, Math.round(calibration.reasoningMedian || 0));
    const reasoningP90 = Math.max(reasoningP50, Math.round(calibration.reasoningP90 || reasoningP50));
    return buildBudget({
      visibleP50, visibleP90,
      visibleP95: Math.max(visibleP90, Math.round(calibration.outputP95 || visibleP90 * 1.12)),
      reasoningP50, reasoningP90,
      reasoningP95: Math.max(reasoningP90, Math.round(calibration.reasoningP95 || reasoningP90 * 1.12)),
      source: "production-empirical", sampleCount: calibration.sampleCount, model
    });
  }

  const requested = Number.isFinite(desiredOutputTokens) && desiredOutputTokens > 0 ? desiredOutputTokens : null;
  const ratio = OUTPUT_RATIOS[analysis.taskType] ?? OUTPUT_RATIOS.general;
  const sizeFloor = { short: 160, medium: 320, long: 700 }[analysis.expectedOutputSize] || 260;
  const visibleP50 = requested
    ? Math.max(32, Math.round(requested * 0.78))
    : clampInt(Math.round(inputTokens * ratio), sizeFloor, 8000);
  const reasoningFactor = REASONING_FACTORS[effort] ?? REASONING_FACTORS["provider-default"];
  const reasoningP50 = Math.round(inputTokens * reasoningFactor * (0.50 + analysis.complexity));
  const visibleP90 = clampInt(Math.ceil(visibleP50 * 1.50), visibleP50, 16000);
  const visibleP95 = clampInt(Math.ceil(visibleP50 * 1.72), visibleP90, 22000);
  const reasoningP90 = clampInt(Math.ceil(reasoningP50 * 1.70), reasoningP50, 30000);
  const reasoningP95 = clampInt(Math.ceil(reasoningP50 * 1.95), reasoningP90, 42000);
  return buildBudget({
    visibleP50, visibleP90, visibleP95, reasoningP50, reasoningP90, reasoningP95,
    source: "heuristic", sampleCount: 0, model
  });
}

function buildBudget({
  visibleP50, visibleP90, visibleP95, reasoningP50, reasoningP90, reasoningP95, source, sampleCount, model
}) {
  const includes = model?.pricing?.outputIncludesReasoning !== false;
  const billed = (visible, reasoning) => includes ? visible + reasoning : visible;
  return {
    visibleOutput: { p50: visibleP50, p90: visibleP90, p95: visibleP95 },
    reasoning: { p50: reasoningP50, p90: reasoningP90, p95: reasoningP95 },
    billedOutput: {
      p50: billed(visibleP50, reasoningP50),
      p90: billed(visibleP90, reasoningP90),
      p95: billed(visibleP95, reasoningP95)
    },
    source, sampleCount
  };
}
function clampInt(value, min, max) { return Math.round(Math.min(max, Math.max(min, value))); }
