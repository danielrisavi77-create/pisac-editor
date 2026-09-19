import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyTask, estimateComplexity, estimateRisk } from "./classify.mjs";
import { loadPrompt, loadWorkflow } from "./prompt.mjs";

async function loadJson(path) {
  return JSON.parse(await readFile(path,"utf8"));
}

function capabilityTier(complexity, risk) {
  if (risk === "high" && complexity >= 4) return "critical";
  if (risk === "high" || complexity >= 4) return "high";
  if (complexity >= 2) return "medium";
  return "low";
}

export async function recommend(taskText, repoRoot = process.cwd()) {
  const aiRoot = resolve(repoRoot, ".ai");
  const [project, routing, models] = await Promise.all([
    loadJson(resolve(aiRoot,"project.json")),
    loadJson(resolve(aiRoot,"routing.json")),
    loadJson(resolve(aiRoot,"models.json"))
  ]);

  const task = classifyTask(taskText);
  const complexity = estimateComplexity(taskText, task);
  const risk = estimateRisk(taskText, task);
  const route = routing.routes[task] || routing.routes.generic || routing.default;
  const tier = capabilityTier(complexity, risk);
  const [promptText, workflowSteps] = await Promise.all([
    loadPrompt(route.prompt, repoRoot),
    loadWorkflow(route.workflow, repoRoot)
  ]);

  const exactSelector = models.selectors.find(s =>
    s.enabled && s.type !== "local" && (!s.requiresEnv || process.env[s.requiresEnv])
  );
  const fallback = models.selectors.find(s => s.enabled && s.type === "local");

  return {
    task,
    complexity,
    risk,
    project: project.project,
    recommendation:{
      workflow: route.workflow,
      workflowSteps,
      prompt: route.prompt,
      promptText,
      reasoning: complexity >= 4 ? "high" : route.reasoning,
      qualityGate: route.qualityGate,
      capabilityTier: tier,
      modelSelector: exactSelector?.id || fallback?.id || "local-policy",
      exactModel: exactSelector?.model || null,
      needsIndependentVerification: risk === "high" || route.qualityGate >= 0.97
    }
  };
}

export function utility({quality=0,cost=0,latency=0,tokens=0,failed=false}, weights={}) {
  const w = {quality:0.58,cost:0.14,latency:0.08,tokens:0.08,failure:0.12,...weights};
  return (
    w.quality * quality -
    w.cost * cost -
    w.latency * latency -
    w.tokens * tokens -
    w.failure * (failed ? 1 : 0)
  );
}
