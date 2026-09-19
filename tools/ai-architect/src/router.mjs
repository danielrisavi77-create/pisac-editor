import { classifyTask, estimateComplexity, estimateRisk } from "./classify.mjs";
import { loadArchitectConfig } from "./config.mjs";
import { loadPrompt, loadWorkflow } from "./prompt.mjs";
import { scanRepo } from "./scanner.mjs";
import { summarizeOutcomes } from "./outcomes.mjs";
import { selectAdaptiveCandidate } from "./adaptive.mjs";

function capabilityTier(complexity, risk) {
  if (risk === "high" && complexity >= 4) return "critical";
  if (risk === "high" || complexity >= 4) return "high";
  if (complexity >= 2) return "medium";
  return "low";
}

function mergedRoute(defaultRoute = {}, route = {}) {
  return {
    ...defaultRoute,
    ...route,
    retrieval: { ...(defaultRoute.retrieval || {}), ...(route.retrieval || {}) },
    verification: { ...(defaultRoute.verification || {}), ...(route.verification || {}) },
    contextBudget: { ...(defaultRoute.contextBudget || {}), ...(route.contextBudget || {}) },
    budgets: { ...(defaultRoute.budgets || {}), ...(route.budgets || {}) },
    generation: { ...(defaultRoute.generation || {}), ...(route.generation || {}) }
  };
}

export async function recommend(taskText, repoRoot = process.cwd(), context = {}) {
  const config = await loadArchitectConfig(repoRoot);
  const task = classifyTask(taskText, context);
  const complexity = estimateComplexity(taskText, task, context);
  const risk = estimateRisk(taskText, task, context);
  const route = mergedRoute(config.routing.default, config.routing.routes?.[task] || config.routing.routes?.generic || {});
  const tier = route.capability || capabilityTier(complexity, risk);
  const [prompt, workflow, projectProfile, stats] = await Promise.all([
    loadPrompt(route.prompt, repoRoot),
    loadWorkflow(route.workflow, repoRoot),
    context.projectProfile ? Promise.resolve(context.projectProfile) : scanRepo(repoRoot),
    Array.isArray(context.outcomeStats) ? Promise.resolve(context.outcomeStats) : summarizeOutcomes(repoRoot)
  ]);

  const reasoning = complexity >= 4 && route.reasoning !== "max" ? "high" : (route.reasoning || "medium");
  const tools = route.tools || [];
  const candidates = config.models.capabilityCandidates?.[tier] || [];
  const adaptive = selectAdaptiveCandidate(candidates, stats, {
    qualityGate: route.qualityGate || 0,
    minSamples: config.models.learning?.minEvaluatedSamples || 3,
    taskClass: task,
    workflow,
    prompt,
    reasoningLevel: reasoning,
    tools
  });

  const verificationRequired = Boolean(
    route.verification?.required ||
    risk === "high" ||
    (route.qualityGate || 0) >= 0.97
  );
  const retrievalRequired = Boolean(route.retrieval?.required);
  const evidenceProvided = Array.isArray(context.retrievedEvidence) && context.retrievedEvidence.length > 0;

  return {
    schemaVersion: 2,
    task,
    feature: context.feature || null,
    complexity,
    risk,
    project: config.project.project,
    projectProfile,
    workflow,
    prompt,
    capabilityTier: tier,
    reasoning,
    tools,
    retrieval: {
      required: retrievalRequired,
      evidenceProvided,
      strategy: route.retrieval?.strategy || null
    },
    verification: {
      required: verificationRequired,
      independent: route.verification?.independent ?? verificationRequired,
      strategy: route.verification?.strategy || (verificationRequired ? "independent-model-review" : "structural")
    },
    contextBudget: route.contextBudget || { maxChars:8000 },
    temperature: route.generation?.temperature ?? null,
    outputBudgetTokens: route.generation?.maxOutputTokens || 4096,
    qualityGate: route.qualityGate || 0,
    budgets: {
      maxCostUsd: route.budgets?.maxCostUsd ?? config.project.execution?.defaultMaxCostUsd ?? 0.08,
      maxLatencyMs: route.budgets?.maxLatencyMs ?? config.project.execution?.defaultMaxLatencyMs ?? 30000
    },
    fallbackPolicy: route.fallbackPolicy || "standard",
    modelSelection: {
      strategy: config.models.strategy || "adaptive",
      candidates,
      preferred: adaptive.candidate,
      basis: adaptive.basis,
      evidence: adaptive.evidence
    }
  };
}

export function explainPlan(plan) {
  const reasons = [];
  reasons.push(`Task class '${plan.task}' maps to workflow ${plan.workflow.id}@${plan.workflow.version}.`);
  reasons.push(`Risk is ${plan.risk} and complexity is ${plan.complexity}/5, so capability tier is ${plan.capabilityTier} with ${plan.reasoning} reasoning.`);
  reasons.push(`Prompt ${plan.prompt.id}@${plan.prompt.version} is selected for this task class.`);
  if (plan.retrieval.required) reasons.push(plan.retrieval.evidenceProvided
    ? "Retrieval evidence is present and may be used."
    : "Retrieval is mandatory, but no evidence has been supplied yet; execution must block rather than guess.");
  if (plan.verification.required) reasons.push("Independent verification is required before the result can be marked successful.");
  if (plan.modelSelection.preferred) {
    reasons.push(`Preferred model route is ${plan.modelSelection.preferred.provider}/${plan.modelSelection.preferred.model}, selected from ${plan.modelSelection.basis}.`);
  } else {
    reasons.push("No executable model candidate is selected at planning time.");
  }
  reasons.push(`Quality gate is ${plan.qualityGate}; candidates below it are not eligible to win on cost alone.`);
  return {
    summary: reasons.join(" "),
    reasons
  };
}
