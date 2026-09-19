import { loadCatalog } from "./catalog.mjs";
import { analyzeTask, estimateCostUsd, roughInputTokens, routeModels } from "./core.mjs";
import { countOpenAIInput, generateOpenAI } from "./providers/openai.mjs";

export function previewAiRequest(input, env = process.env) {
  validateInput(input);
  const profile = input.profile || "standard";
  const catalog = loadCatalog(env);
  const analysis = analyzeTask({ prompt: input.prompt, context: input.context || "", profile });
  const inputTokens = roughInputTokens({
    prompt: input.prompt,
    context: input.context || "",
    instructions: input.instructions || ""
  });
  const routing = routeModels({
    catalog,
    inputTokens,
    analysis,
    profile,
    desiredOutputTokens: input.desiredOutputTokens
  });
  return {
    profile,
    analysis,
    inputTokens: { value: inputTokens, method: "heuristic" },
    routing
  };
}

export async function countAiRequest(input, env = process.env) {
  const preview = previewAiRequest(input, env);
  let selected = preview.routing.recommended;
  if (!selected) throw new Error("No configured model fits this request.");
  let exact = await exactCount(selected, input, env);
  let routing = routeModels({
    catalog: loadCatalog(env),
    inputTokens: exact.inputTokens,
    analysis: preview.analysis,
    profile: preview.profile,
    desiredOutputTokens: input.desiredOutputTokens
  });
  if (!routing.recommended) throw new Error("No configured model fits this request after exact token count.");
  if (routing.recommended.provider !== selected.provider || routing.recommended.model !== selected.model) {
    selected = routing.recommended;
    exact = await exactCount(selected, input, env);
    routing = routeModels({
      catalog: loadCatalog(env),
      inputTokens: exact.inputTokens,
      analysis: preview.analysis,
      profile: preview.profile,
      desiredOutputTokens: input.desiredOutputTokens
    });
  }
  return {
    ...preview,
    inputTokens: { value: exact.inputTokens, estimatedValue: preview.inputTokens.value, method: "provider-exact" },
    routing
  };
}

export async function executeAiRequest(input, env = process.env) {
  const counted = await countAiRequest(input, env);
  const selected = counted.routing.recommended;
  if (!selected) throw new Error("No model selected.");
  if (selected.provider !== "openai") {
    throw new Error("Execution adapter is not yet enabled for provider: " + selected.provider);
  }
  const maxOutputTokens = Math.min(
    selected.maxOutputTokens,
    Math.max(256, selected.tokenBudget.totalBilledOutput.p90)
  );
  const result = await generateOpenAI({
    apiKey: env.OPENAI_API_KEY,
    model: selected.model,
    prompt: input.prompt,
    context: input.context || "",
    instructions: input.instructions || "",
    effort: selected.effort,
    maxOutputTokens
  });
  const actualCostUsd = estimateActualCost(selected, result.usage);
  return {
    ...counted,
    execution: {
      provider: selected.provider,
      model: selected.model,
      effort: selected.effort,
      text: result.text,
      status: result.status,
      responseId: result.responseId,
      latencyMs: result.latencyMs,
      usage: result.usage,
      actualCostUsd,
      predictionError: predictionError(selected, result.usage, actualCostUsd)
    }
  };
}

async function exactCount(model, input, env) {
  if (model.provider === "openai") {
    return countOpenAIInput({
      apiKey: env.OPENAI_API_KEY,
      model: model.model,
      prompt: input.prompt,
      context: input.context || "",
      instructions: input.instructions || ""
    });
  }
  throw new Error("Exact token counting adapter is not yet enabled for provider: " + model.provider);
}

function estimateActualCost(model, usage) {
  const totalInput = usage.inputTokens || 0;
  const cached = Math.min(usage.cachedInputTokens || 0, totalInput);
  const cacheWrite = Math.min(usage.cacheWriteTokens || 0, Math.max(0, totalInput - cached));
  const uncached = Math.max(0, totalInput - cached - cacheWrite);
  const cachedRate = model.cachedInputUsdPerM ?? model.inputUsdPerM * 0.1;
  const cacheWriteRate = model.cacheWriteUsdPerM ?? model.inputUsdPerM * 1.25;
  const inputCost =
    (uncached / 1000000) * model.inputUsdPerM +
    (cached / 1000000) * cachedRate +
    (cacheWrite / 1000000) * cacheWriteRate;
  const outputCost = ((usage.outputTokens || 0) / 1000000) * model.outputUsdPerM;
  return round6(inputCost + outputCost);
}

function predictionError(model, usage, actualCostUsd) {
  const predictedOutput = model.tokenBudget.totalBilledOutput.p90 || 1;
  const actualOutput = usage.outputTokens || 0;
  return {
    outputTokensPct: round2(((actualOutput - predictedOutput) / predictedOutput) * 100),
    costPct: model.estimatedCostUsd > 0 ? round2(((actualCostUsd - model.estimatedCostUsd) / model.estimatedCostUsd) * 100) : null
  };
}

function validateInput(input) {
  if (!input || typeof input !== "object") throw new Error("JSON body is required.");
  if (typeof input.prompt !== "string" || !input.prompt.trim()) throw new Error("prompt is required.");
  if (input.prompt.length > 500000) throw new Error("prompt exceeds the V1 safety limit.");
  if (input.context && String(input.context).length > 2000000) throw new Error("context exceeds the V1 safety limit.");
}

function round2(value) { return Math.round(value * 100) / 100; }
function round6(value) { return Math.round(value * 1000000) / 1000000; }
