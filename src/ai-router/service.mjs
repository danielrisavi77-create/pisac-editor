import { analyzeTaskV2 } from "./classifier.mjs";
import { optimizeContext, roughInputTokens } from "./context.mjs";
import { RouterError } from "./errors.mjs";
import { normalizeBudget, PROFILES_V2 } from "./budget.mjs";
import { predictTokenBudgetV2 } from "./predictor.mjs";
import { calculateActualCost, estimateCostEnvelope } from "./pricing.mjs";
import { configuredProviders, DEFAULT_ADAPTERS, getProviderApiKey } from "./providers/index.mjs";
import { loadRegistry } from "./registry.mjs";
import { generateCandidates } from "./router.mjs";
import { verifyResult } from "./verifier.mjs";

const CONTEXT_DEFAULTS = { fast: 16000, economy: 20000, balanced: 48000, quality: 96000, critical: 160000 };

export function previewAiRequest(input, env = process.env, deps = {}) {
  validateInput(input);
  const profile = normalizeProfile(input.profile);
  const budget = normalizeBudget(input.budget || {}, profile);
  const analysis = analyzeTaskV2({
    prompt: input.prompt,
    context: input.context || "",
    contextSegments: input.contextSegments || [],
    profile,
    requirements: input.requirements || {}
  });
  const maxContextTokens = Number.isFinite(input.contextBudgetTokens)
    ? Math.max(0, Number(input.contextBudgetTokens))
    : Math.min(
        budget.maxInputTokens || Infinity,
        CONTEXT_DEFAULTS[profile] || CONTEXT_DEFAULTS.balanced
      );
  const optimized = optimizeContext({
    prompt: input.prompt,
    context: input.context || "",
    contextSegments: input.contextSegments || [],
    maxContextTokens
  });
  const heuristicInput = roughInputTokens({
    prompt: input.prompt,
    context: optimized.text,
    instructions: input.instructions || ""
  });
  const registry = deps.registry || loadRegistry(env);
  const routing = generateCandidates({
    registry,
    inputTokens: heuristicInput,
    analysis,
    profile,
    budget,
    desiredOutputTokens: input.desiredOutputTokens,
    calibration: deps.calibration || {}
  });
  return {
    version: "v2",
    profile,
    analysis,
    budget,
    contextOptimization: optimized.stats,
    optimizedContext: optimized.text,
    inputTokens: { value: heuristicInput, method: "heuristic" },
    routing,
    simulator: buildCostSimulator(routing)
  };
}

export async function countAiRequest(input, env = process.env, deps = {}) {
  const preview = previewAiRequest(input, env, deps);
  const adapters = deps.adapters || DEFAULT_ADAPTERS;
  const providers = deps.availableProviders || configuredProviders(env);
  if (!providers.length) {
    throw new RouterError("NO_PROVIDER_CONFIGURED", "No AI provider API key is configured on the server.", 503);
  }
  const registry = deps.registry || loadRegistry(env);
  const initial = generateCandidates({
    registry,
    inputTokens: preview.inputTokens.value,
    analysis: preview.analysis,
    profile: preview.profile,
    budget: preview.budget,
    desiredOutputTokens: input.desiredOutputTokens,
    calibration: deps.calibration || {},
    availableProviders: providers
  });
  if (!initial.recommended) {
    throw new RouterError("NO_VALID_CANDIDATE", "No configured model can satisfy this request and budget.", 422, initial.noCandidateReason);
  }

  const unique = [];
  const seen = new Set();
  const limit = clampInt(input.countCandidatesLimit ?? 5, 1, 8);
  for (const candidate of initial.candidates) {
    const key = modelKey(candidate);
    if (!seen.has(key)) {
      unique.push(candidate);
      seen.add(key);
      if (unique.length >= limit) break;
    }
  }

  const settled = await Promise.all(unique.map(async (candidate) => {
    const adapter = adapters[candidate.provider];
    if (!adapter?.supportsExactTokenCount || !candidate.supportsTokenCounting) {
      return { key: modelKey(candidate), provider: candidate.provider, model: candidate.model, method: "heuristic", inputTokens: null };
    }
    try {
      const counted = await adapter.countTokens({
        apiKey: getProviderApiKey(candidate.provider, env),
        model: candidate.model,
        prompt: input.prompt,
        context: preview.optimizedContext,
        instructions: input.instructions || "",
        effort: candidate.effort,
        cacheTtl: input.cacheTtl || "5m",
        timeoutMs: input.providerTimeoutMs
      });
      return { key: modelKey(candidate), provider: candidate.provider, model: candidate.model, ...counted };
    } catch (error) {
      return {
        key: modelKey(candidate), provider: candidate.provider, model: candidate.model,
        method: "heuristic-fallback", inputTokens: null, errorCode: error?.code || "TOKEN_COUNT_FAILED"
      };
    }
  }));

  const inputTokenCounts = {};
  const exactCounts = [...settled];
  for (const item of exactCounts) if (Number.isFinite(item.inputTokens)) inputTokenCounts[item.key] = item.inputTokens;

  let routing = generateCandidates({
    registry,
    inputTokens: preview.inputTokens.value,
    inputTokenCounts,
    analysis: preview.analysis,
    profile: preview.profile,
    budget: preview.budget,
    desiredOutputTokens: input.desiredOutputTokens,
    calibration: deps.calibration || {},
    availableProviders: providers
  });
  if (!routing.recommended) {
    throw new RouterError("NO_VALID_CANDIDATE", "No model can satisfy the request after provider token counting.", 422, routing.noCandidateReason);
  }

  for (let stabilization = 0; stabilization < 2; stabilization += 1) {
    const recommended = routing.recommended;
    const key = modelKey(recommended);
    const alreadyExact = exactCounts.some((x) => x.key === key && Number.isFinite(x.inputTokens));
    const adapter = adapters[recommended.provider];
    if (alreadyExact || !adapter?.supportsExactTokenCount || !recommended.supportsTokenCounting) break;
    try {
      const counted = await adapter.countTokens({
        apiKey: getProviderApiKey(recommended.provider, env),
        model: recommended.model,
        prompt: input.prompt,
        context: preview.optimizedContext,
        instructions: input.instructions || "",
        effort: recommended.effort,
        cacheTtl: input.cacheTtl || "5m",
        timeoutMs: input.providerTimeoutMs
      });
      if (!Number.isFinite(counted.inputTokens)) break;
      const item = { key, provider: recommended.provider, model: recommended.model, ...counted };
      exactCounts.push(item);
      inputTokenCounts[key] = counted.inputTokens;
      routing = generateCandidates({
        registry,
        inputTokens: preview.inputTokens.value,
        inputTokenCounts,
        analysis: preview.analysis,
        profile: preview.profile,
        budget: preview.budget,
        desiredOutputTokens: input.desiredOutputTokens,
        calibration: deps.calibration || {},
        availableProviders: providers
      });
      if (!routing.recommended) {
        throw new RouterError("NO_VALID_CANDIDATE", "No model can satisfy the request after final exact token counting.", 422, routing.noCandidateReason);
      }
    } catch (error) {
      if (error instanceof RouterError) throw error;
      break;
    }
  }

  const recommendedKey = modelKey(routing.recommended);
  const exact = exactCounts.find((x) => x.key === recommendedKey && Number.isFinite(x.inputTokens));
  return {
    ...preview,
    inputTokens: exact
      ? { value: exact.inputTokens, estimatedValue: preview.inputTokens.value, method: "provider-exact", provider: exact.provider, model: exact.model }
      : { value: routing.recommended.inputTokens, estimatedValue: preview.inputTokens.value, method: "heuristic", provider: routing.recommended.provider, model: routing.recommended.model },
    exactCounts,
    routing,
    simulator: buildCostSimulator(routing)
  };
}

export async function executeAiRequest(input, env = process.env, deps = {}) {
  if (input?.requirements?.tools === true) {
    throw new RouterError("TOOL_BROKER_REQUIRED", "Arbitrary tool execution is not enabled in the generic AI Router. Route tool requests through a permissioned tool broker.", 501);
  }
  const startedAt = Date.now();
  const rawMaxLatency = Number.isFinite(Number(input?.budget?.maxLatencyMs))
    ? Number(input.budget.maxLatencyMs)
    : null;
  const counted = await countAiRequest({
    ...input,
    providerTimeoutMs: effectiveProviderTimeout(input.providerTimeoutMs, rawMaxLatency, startedAt)
  }, env, deps);
  const adapters = deps.adapters || DEFAULT_ADAPTERS;
  const attempts = [];
  const triedExecutionKeys = new Set();
  let totalCostUsd = 0;
  let totalTokens = 0;
  let retryCount = 0;
  let escalationCount = 0;
  let fallbackCount = 0;
  let prompt = input.prompt;
  let candidate = counted.routing.recommended;
  let lastText = "";
  let lastVerification = null;
  let firstPassSuccess = false;
  let nextKind = "initial";

  while (candidate) {
    assertLatencyBudget(counted.budget, startedAt);
    candidate = await prepareCandidateForExecution({
      candidate, prompt, context: counted.optimizedContext, instructions: input.instructions || "",
      analysis: counted.analysis,
      input: {
        ...input,
        providerTimeoutMs: effectiveProviderTimeout(input.providerTimeoutMs, counted.budget.maxLatencyMs, startedAt)
      },
      env, adapters
    });

    try {
      assertAggregateBudget({
        budget: counted.budget, candidate, totalCostUsd, totalTokens,
        elapsedMs: Date.now() - startedAt
      });
    } catch (error) {
      error.partialResult = buildPartialExecutionResult({
        counted, attempts, candidate, totalCostUsd, totalTokens, retryCount,
        escalationCount, fallbackCount, firstPassSuccess, verification: lastVerification,
        text: lastText, startedAt
      });
      throw error;
    }

    let result = null;
    let providerFailure = null;
    let localRetry = 0;
    const maxRetries = counted.budget.maxRetries;

    while (localRetry <= maxRetries) {
      try {
        assertAggregateBudget({
          budget: counted.budget,
          candidate,
          totalCostUsd,
          totalTokens,
          elapsedMs: Date.now() - startedAt
        });
      } catch (error) {
        error.partialResult = buildPartialExecutionResult({
          counted, attempts, candidate, totalCostUsd, totalTokens, retryCount,
          escalationCount, fallbackCount, firstPassSuccess, verification: lastVerification,
          text: lastText, startedAt
        });
        throw error;
      }
      const attemptKind = localRetry > 0 ? "retry" : nextKind;
      if (localRetry > 0) retryCount += 1;
      const attemptNumber = attempts.length + 1;
      try {
        const adapter = adapters[candidate.provider];
        if (!adapter) throw new RouterError("PROVIDER_ADAPTER_MISSING", "Provider adapter is not configured.", 500);
        const apiKey = getProviderApiKey(candidate.provider, env);
        result = await adapter.generate({
          apiKey,
          model: candidate.model,
          prompt,
          context: counted.optimizedContext,
          instructions: input.instructions || "",
          effort: candidate.effort,
          maxOutputTokens: Math.min(candidate.maxOutputTokens, candidate.tokenBudget.billedOutput.p95),
          cacheTtl: input.cacheTtl || "5m",
          promptCacheKey: input.cacheKey || null,
          timeoutMs: effectiveProviderTimeout(input.providerTimeoutMs, counted.budget.maxLatencyMs, startedAt)
        });
        const actual = calculateActualCost(candidate, result.usage, { cacheTtl: input.cacheTtl || "5m" });
        totalCostUsd += actual.totalUsd;
        totalTokens += (result.usage.inputTokens || 0) + (result.usage.outputTokens || 0);
        lastText = result.text;
        lastVerification = verifyResult({
          text: result.text,
          analysis: counted.analysis,
          verification: input.verification || {},
          profile: counted.profile
        });
        attempts.push(buildAttempt({
          attemptNumber, attemptKind, candidate, result, actual, verification: lastVerification, success: lastVerification.passed
        }));
        if (lastVerification.passed) {
          if (attemptNumber === 1) firstPassSuccess = true;
          return buildExecutionResult({
            counted, attempts, result, candidate, totalCostUsd, totalTokens, retryCount, escalationCount,
            fallbackCount, firstPassSuccess, finalSuccess: true, verification: lastVerification, startedAt
          });
        }
        providerFailure = null;
        break;
      } catch (error) {
        providerFailure = error;
        attempts.push(buildFailureAttempt({
          attemptNumber, attemptKind, candidate, error
        }));
        if (!error?.transient || localRetry >= maxRetries) break;
        localRetry += 1;
        await sleep(Math.min(error.retryAfterMs || 250 * (2 ** (localRetry - 1)), 1500));
      }
    }

    triedExecutionKeys.add(executionKey(candidate));

    if (providerFailure) {
      const fallback = counted.routing.candidates.find((item) =>
        item.provider !== candidate.provider &&
        item.quality.capabilityRank >= candidate.quality.capabilityRank &&
        !triedExecutionKeys.has(executionKey(item))
      );
      if (!fallback) {
        const error = new RouterError("PROVIDER_FALLBACK_EXHAUSTED", "Provider execution failed and no compatible fallback remains.", 502, {
          provider: candidate.provider,
          model: candidate.model,
          code: providerFailure.code || "PROVIDER_ERROR"
        });
        error.partialResult = buildPartialExecutionResult({
          counted, attempts, candidate, totalCostUsd, totalTokens, retryCount,
          escalationCount, fallbackCount, firstPassSuccess, verification: lastVerification,
          text: lastText, startedAt
        });
        throw error;
      }
      fallbackCount += 1;
      nextKind = "fallback";
      candidate = fallback;
      continue;
    }

    if (!lastVerification?.passed) {
      if (escalationCount >= counted.budget.maxEscalations) {
        return buildExecutionResult({
          counted, attempts, result: { text: lastText, usage: {}, latencyMs: 0, status: "verification_failed", responseId: null },
          candidate, totalCostUsd, totalTokens, retryCount, escalationCount, fallbackCount,
          firstPassSuccess, finalSuccess: false, verification: lastVerification, startedAt
        });
      }
      const escalation = pickEscalation(candidate, counted.routing.candidates, triedExecutionKeys);
      if (!escalation) {
        return buildExecutionResult({
          counted, attempts, result: { text: lastText, usage: {}, latencyMs: 0, status: "verification_failed", responseId: null },
          candidate, totalCostUsd, totalTokens, retryCount, escalationCount, fallbackCount,
          firstPassSuccess, finalSuccess: false, verification: lastVerification, startedAt
        });
      }
      escalationCount += 1;
      prompt = buildEscalationPrompt(input.prompt, lastText, lastVerification);
      nextKind = "escalation";
      candidate = escalation;
      continue;
    }
  }

  throw new RouterError("EXECUTION_EXHAUSTED", "AI Router exhausted all valid execution candidates.", 502);
}

async function prepareCandidateForExecution({ candidate, prompt, context, instructions, analysis, input, env, adapters }) {
  const adapter = adapters[candidate.provider];
  let inputTokens = candidate.inputTokens;
  let method = "heuristic";
  if (adapter?.supportsExactTokenCount && candidate.supportsTokenCounting) {
    try {
      const counted = await adapter.countTokens({
        apiKey: getProviderApiKey(candidate.provider, env), model: candidate.model, prompt, context, instructions,
        effort: candidate.effort, cacheTtl: input.cacheTtl || "5m", timeoutMs: input.providerTimeoutMs
      });
      if (Number.isFinite(counted.inputTokens)) {
        inputTokens = counted.inputTokens;
        method = "provider-exact";
      }
    } catch {
      method = "heuristic-fallback";
    }
  }
  const tokenBudget = predictTokenBudgetV2({
    inputTokens, analysis, model: candidate, effort: candidate.effort,
    desiredOutputTokens: input.desiredOutputTokens
  });
  const costEnvelope = estimateCostEnvelope({
    model: candidate,
    inputTokens,
    tokenBudget,
    percentile: "p90",
    cacheTtl: input.cacheTtl || "5m"
  });
  return {
    ...candidate,
    inputTokens,
    inputTokenMethod: method,
    tokenBudget,
    estimatedCost: costEnvelope.expected,
    estimatedBudgetCost: costEnvelope.coldCacheCeiling
  };
}

function pickEscalation(current, candidates, tried) {
  const effortRank = { "provider-default": 1, none: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
  return candidates.find((item) => {
    if (tried.has(executionKey(item))) return false;
    const strongerModel = item.quality.capabilityRank > current.quality.capabilityRank;
    const strongerEffort = item.quality.capabilityRank === current.quality.capabilityRank &&
      (effortRank[item.effort] || 0) > (effortRank[current.effort] || 0);
    return strongerModel || strongerEffort;
  }) || null;
}

function buildEscalationPrompt(originalTask, previousText, verification) {
  const failures = (verification?.failures || []).map((x) => "- " + x.code + ": " + x.message).join("\n");
  return [
    "ORIGINAL TASK", originalTask,
    "",
    "PREVIOUS ATTEMPT", String(previousText || "").slice(0, 12000),
    "",
    "VERIFICATION FAILURES", failures || "- The previous result did not satisfy the output contract.",
    "",
    "CORRECTION INSTRUCTION",
    "Produce a corrected result that directly satisfies the original task and fixes every verification failure. Do not discuss the retry process."
  ].join("\n");
}

function assertLatencyBudget(budget, startedAt) {
  if (budget.maxLatencyMs != null && Date.now() - startedAt >= budget.maxLatencyMs) {
    throw new RouterError("LATENCY_BUDGET_EXCEEDED", "The request exceeded maxLatencyMs.", 408);
  }
}

function effectiveProviderTimeout(configuredTimeoutMs, maxLatencyMs, startedAt) {
  const configured = Number.isFinite(Number(configuredTimeoutMs)) && Number(configuredTimeoutMs) > 0
    ? Number(configuredTimeoutMs)
    : 45000;
  if (!Number.isFinite(Number(maxLatencyMs)) || Number(maxLatencyMs) <= 0) return configured;
  const remaining = Math.max(1, Number(maxLatencyMs) - (Date.now() - startedAt));
  return Math.max(1, Math.min(configured, remaining));
}

function assertAggregateBudget({ budget, candidate, totalCostUsd, totalTokens, elapsedMs }) {
  const nextBudgetCost = candidate.estimatedBudgetCost?.totalUsd ?? candidate.estimatedCost.totalUsd;
  if (budget.maxCostUsd != null && totalCostUsd + nextBudgetCost > budget.maxCostUsd) {
    throw new RouterError("AGGREGATE_COST_BUDGET_EXCEEDED", "The next attempt would exceed maxCostUsd.", 422, {
      spentUsd: round6(totalCostUsd), nextEstimatedUsd: candidate.estimatedCost.totalUsd, nextBudgetCeilingUsd: nextBudgetCost, maxCostUsd: budget.maxCostUsd
    });
  }
  if (budget.maxTotalTokens != null &&
    totalTokens + candidate.inputTokens + candidate.tokenBudget.billedOutput.p95 > budget.maxTotalTokens) {
    throw new RouterError("AGGREGATE_TOKEN_BUDGET_EXCEEDED", "The next attempt would exceed maxTotalTokens.", 422);
  }
  if (budget.maxLatencyMs != null && elapsedMs >= budget.maxLatencyMs) {
    throw new RouterError("LATENCY_BUDGET_EXCEEDED", "The request exceeded maxLatencyMs before the next attempt.", 408);
  }
}

function buildAttempt({ attemptNumber, attemptKind, candidate, result, actual, verification, success }) {
  return {
    attemptNumber, attemptKind, provider: candidate.provider, model: candidate.model, effort: candidate.effort,
    inputTokenMethod: candidate.inputTokenMethod || "heuristic", inputTokensEstimated: candidate.inputTokens,
    outputP50: candidate.tokenBudget.billedOutput.p50, outputP90: candidate.tokenBudget.billedOutput.p90,
    outputP95: candidate.tokenBudget.billedOutput.p95, predictedReasoningP90: candidate.tokenBudget.reasoning.p90,
    estimatedCostUsd: candidate.estimatedCost.totalUsd, actualCostUsd: actual.totalUsd,
    actualCostSource: actual.source, latencyMs: result.latencyMs, usage: result.usage,
    verifierScore: verification.score, verifierPassed: verification.passed,
    verifierFailures: verification.failures.map((x) => x.code), success
  };
}

function buildFailureAttempt({ attemptNumber, attemptKind, candidate, error }) {
  return {
    attemptNumber, attemptKind, provider: candidate.provider, model: candidate.model, effort: candidate.effort,
    inputTokenMethod: candidate.inputTokenMethod || "heuristic", inputTokensEstimated: candidate.inputTokens,
    estimatedCostUsd: candidate.estimatedCost.totalUsd, actualCostUsd: 0, latencyMs: null,
    verifierScore: null, verifierPassed: false, verifierFailures: [],
    success: false, errorType: error?.code || "PROVIDER_ERROR", transient: Boolean(error?.transient)
  };
}

function buildPartialExecutionResult({
  counted, attempts, candidate, totalCostUsd, totalTokens, retryCount, escalationCount,
  fallbackCount, firstPassSuccess, verification, text, startedAt
}) {
  return buildExecutionResult({
    counted,
    attempts,
    result: {
      text: text || "",
      usage: {},
      latencyMs: 0,
      status: "failed",
      responseId: null
    },
    candidate,
    totalCostUsd,
    totalTokens,
    retryCount,
    escalationCount,
    fallbackCount,
    firstPassSuccess,
    finalSuccess: false,
    verification: verification || null,
    startedAt
  });
}

function buildExecutionResult({
  counted, attempts, result, candidate, totalCostUsd, totalTokens, retryCount, escalationCount,
  fallbackCount, firstPassSuccess, finalSuccess, verification, startedAt
}) {
  return {
    ...counted,
    execution: {
      provider: candidate.provider, model: candidate.model, effort: candidate.effort,
      text: result.text, status: result.status, responseId: result.responseId,
      latencyMs: Date.now() - startedAt, finalAttemptLatencyMs: result.latencyMs,
      finalUsage: result.usage, totalActualCostUsd: round6(totalCostUsd), totalActualTokens: totalTokens,
      retryCount, escalationCount, fallbackCount, attempts: attempts.length,
      firstPassSuccess, finalSuccess, verification
    },
    attempts
  };
}

function buildCostSimulator(routing) {
  const recommended = routing.recommended;
  if (!recommended) {
    return {
      recommended: null,
      alternatives: [],
      baseline: null,
      estimatedSavings: null
    };
  }
  const alternatives = routing.candidates.slice(1, 4).map(simRow);
  const baselineCandidate = [...routing.candidates].sort((a, b) =>
    b.quality.capabilityRank - a.quality.capabilityRank ||
    (b.effort === "max" ? 1 : 0) - (a.effort === "max" ? 1 : 0) ||
    b.estimatedCost.totalUsd - a.estimatedCost.totalUsd
  )[0];
  const baselineCost = baselineCandidate?.estimatedCost?.totalUsd || recommended.estimatedCost.totalUsd;
  const routedCost = recommended.estimatedCost.totalUsd;
  const savingUsd = Math.max(0, baselineCost - routedCost);
  return {
    recommended: simRow(recommended),
    alternatives,
    baseline: {
      policy: "strongest-eligible-one-shot-p90",
      ...simRow(baselineCandidate)
    },
    estimatedSavings: {
      usd: round6(savingUsd),
      pct: baselineCost > 0 ? round2((savingUsd / baselineCost) * 100) : 0
    },
    qualityNumbersAreEmpirical: recommended.quality.source === "production-empirical"
  };
}
function simRow(candidate) {
  return {
    provider: candidate.provider, model: candidate.model, effort: candidate.effort,
    estimatedP90CostUsd: candidate.estimatedCost.totalUsd,
    coldCacheP90CeilingUsd: candidate.estimatedBudgetCost?.totalUsd ?? candidate.estimatedCost.totalUsd,
    expectedRetryCostUsd: candidate.expectedRetryCostUsd,
    expectedEscalationCostUsd: candidate.expectedEscalationCostUsd,
    expectedVerificationCostUsd: candidate.expectedVerificationCostUsd,
    expectedTotalCostUsd: candidate.expectedTotalCostUsd,
    expectedCostPerSuccessfulTaskUsd: candidate.expectedCostPerSuccessfulTaskUsd,
    successProbability: candidate.quality.successProbability,
    firstPassSuccessProbability: candidate.quality.firstPassSuccessProbability,
    needsRetryProbability: candidate.quality.needsRetryProbability,
    needsEscalationProbability: candidate.quality.needsEscalationProbability,
    expectedQuality: candidate.quality.expectedQuality,
    qualityEstimateSource: candidate.quality.source,
    capabilityRank: candidate.quality.capabilityRank,
    selectionScore: candidate.selectionScore
  };
}

function validateInput(input) {
  if (!input || typeof input !== "object") throw new RouterError("INVALID_BODY", "JSON body is required.", 400);
  if (typeof input.prompt !== "string" || !input.prompt.trim()) throw new RouterError("PROMPT_REQUIRED", "prompt is required.", 400);
  if (input.prompt.length > 500000) throw new RouterError("PROMPT_TOO_LARGE", "prompt exceeds the router safety limit.", 413);
  if (input.context && String(input.context).length > 2000000) throw new RouterError("CONTEXT_TOO_LARGE", "context exceeds the router safety limit.", 413);
  if (Array.isArray(input.contextSegments) && input.contextSegments.length > 500) throw new RouterError("TOO_MANY_CONTEXT_SEGMENTS", "contextSegments exceeds the router safety limit.", 413);
}
function normalizeProfile(profile) {
  const value = profile === "standard" ? "balanced" : (profile || "balanced");
  return PROFILES_V2[value] ? value : "balanced";
}
function modelKey(candidate) { return candidate.provider + "|" + candidate.model; }
function executionKey(candidate) { return candidate.provider + "|" + candidate.model + "|" + candidate.effort; }
function clampInt(v, min, max) { return Math.round(Math.min(max, Math.max(min, Number(v) || min))); }
function round2(v) { return Math.round(v * 100) / 100; }
function round6(v) { return Math.round(v * 1000000) / 1000000; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
