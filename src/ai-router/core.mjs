const TASK_PATTERNS = [
  ["code", /\b(code|bug|typescript|javascript|python|repo|repository|ci|test|build|deploy|function|class|api)\b/i],
  ["academic", /\b(diplom|seminar|academic|citation|reference|literature|thesis|paper|research|metodolog|statistic)\w*/i],
  ["rewrite", /\b(rewrite|rephrase|proofread|edit|polish|preformul|prepi|ispravi|uredi tekst)\w*/i],
  ["analysis", /\b(analy[sz]|uspored|compare|evaluate|audit|research|istra[žz]|procijen|review)\w*/i]
];

const RISK_PATTERN = /\b(production|release|merge|security|payment|delete|migration|legal|medical|submit|predaj|objav|sigurn|pla[ćc]anj|bris|deploy)\w*/gi;
const MULTI_STEP_PATTERN = /\b(and then|after that|zatim|onda|nakon toga|te potom|korak|step)\b/gi;

export const PROFILES = {
  fast: { baseTier: 1, defaultEffort: "low", maxEscalations: 0 },
  standard: { baseTier: 1, defaultEffort: "medium", maxEscalations: 1 },
  quality: { baseTier: 2, defaultEffort: "high", maxEscalations: 1 },
  critical: { baseTier: 3, defaultEffort: "high", maxEscalations: 2 }
};

export function analyzeTask({ prompt, context = "", profile = "standard" }) {
  const combined = String(prompt || "") + "\n" + String(context || "");
  const chars = combined.length;
  const words = combined.trim() ? combined.trim().split(/\s+/).length : 0;
  const taskType = TASK_PATTERNS.find((entry) => entry[1].test(prompt || ""))?.[0] || "general";
  const riskHits = (combined.match(RISK_PATTERN) || []).length;
  const stepHits = ((prompt || "").match(MULTI_STEP_PATTERN) || []).length;
  const codeSignals = /```|\b(error|exception|stack trace|npm|pnpm|git|sql)\b/i.test(combined) ? 1 : 0;
  const sizeScore = clamp(Math.log10(Math.max(chars, 100)) / 6, 0.12, 0.72);
  const complexity = clamp(
    0.10 + sizeScore * 0.55 + Math.min(stepHits, 5) * 0.05 + codeSignals * 0.08 +
      (taskType === "analysis" || taskType === "academic" ? 0.08 : 0),
    0.05,
    1
  );
  const risk = clamp(0.08 + Math.min(riskHits, 6) * 0.12, 0.05, 1);
  const p = PROFILES[profile] || PROFILES.standard;
  let requiredTier = p.baseTier;
  if (complexity >= 0.68) requiredTier += 1;
  if (risk >= 0.56) requiredTier += 1;
  requiredTier = Math.min(3, requiredTier);
  return { taskType, chars, words, complexity, risk, requiredTier };
}

export function roughInputTokens({ prompt = "", context = "", instructions = "" }) {
  const text = String(instructions) + "\n" + String(context) + "\n" + String(prompt);
  const characterEstimate = Math.ceil(text.length / 3.6);
  const structuralOverhead = 24;
  return Math.max(1, characterEstimate + structuralOverhead);
}

export function predictTokenBudget({ inputTokens, analysis, desiredOutputTokens, effort = "medium" }) {
  const typeRatio = { rewrite: 0.55, code: 0.42, academic: 0.48, analysis: 0.45, general: 0.34 }[analysis.taskType] || 0.34;
  const requested = Number.isFinite(desiredOutputTokens) && desiredOutputTokens > 0 ? desiredOutputTokens : null;
  const visibleP50 = requested ? Math.round(requested * 0.78) : clampInt(Math.round(inputTokens * typeRatio), 220, 6000);
  const effortFactor = { none: 0, low: 0.10, medium: 0.22, high: 0.38, xhigh: 0.55, max: 0.72 }[effort] ?? 0.22;
  const reasoningP50 = Math.round(inputTokens * effortFactor * (0.55 + analysis.complexity));
  const visibleP90 = clampInt(Math.ceil(visibleP50 * 1.55), visibleP50, 12000);
  const reasoningP90 = clampInt(Math.ceil(reasoningP50 * 1.75), reasoningP50, 24000);
  return {
    visibleOutput: { p50: visibleP50, p90: visibleP90 },
    reasoning: { p50: reasoningP50, p90: reasoningP90 },
    totalBilledOutput: { p50: visibleP50 + reasoningP50, p90: visibleP90 + reasoningP90 }
  };
}

export function estimateCostUsd(model, inputTokens, tokenBudget) {
  const input = (inputTokens / 1000000) * model.inputUsdPerM;
  const output = (tokenBudget.totalBilledOutput.p90 / 1000000) * model.outputUsdPerM;
  return round6(input + output);
}

export function routeModels({ catalog, inputTokens, analysis, profile = "standard", desiredOutputTokens }) {
  const p = PROFILES[profile] || PROFILES.standard;
  const candidates = catalog
    .filter((model) => model.tier >= analysis.requiredTier)
    .map((model) => {
      const effort = chooseEffort(model, p.defaultEffort, analysis);
      const tokenBudget = predictTokenBudget({ inputTokens, analysis, desiredOutputTokens, effort });
      const fitsContext = inputTokens + tokenBudget.totalBilledOutput.p90 <= model.contextWindow;
      const fitsOutput = tokenBudget.totalBilledOutput.p90 <= model.maxOutputTokens;
      return {
        ...model,
        effort,
        tokenBudget,
        estimatedCostUsd: estimateCostUsd(model, inputTokens, tokenBudget),
        fitsContext,
        fitsOutput
      };
    })
    .filter((model) => model.fitsContext && model.fitsOutput)
    .sort((a, b) => a.estimatedCostUsd - b.estimatedCostUsd || a.tier - b.tier);
  return { candidates, recommended: candidates[0] || null, maxEscalations: p.maxEscalations };
}

function chooseEffort(model, baseEffort, analysis) {
  if (!model.supportsReasoningEffort) return "provider-default";
  if (analysis.complexity >= 0.85 || analysis.risk >= 0.68) return "high";
  if (analysis.complexity <= 0.30 && analysis.risk <= 0.20) return "low";
  return baseEffort;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value, min, max) {
  return Math.round(clamp(value, min, max));
}

function round6(value) {
  return Math.round(value * 1000000) / 1000000;
}
