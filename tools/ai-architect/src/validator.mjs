import { loadArchitectConfig } from "./config.mjs";

function asId(ref) {
  return typeof ref === "string" ? ref : ref?.id;
}

export async function validateConfig(repoRoot = process.cwd()) {
  const cfg = await loadArchitectConfig(repoRoot);
  const errors = [];
  const warnings = [];

  for (const [name, doc] of Object.entries({
    project:cfg.project,
    routing:cfg.routing,
    models:cfg.models,
    prompts:cfg.prompts,
    workflows:cfg.workflows
  })) {
    if (doc.schemaVersion !== 2) errors.push(`${name}.json must use schemaVersion 2`);
  }

  if (!cfg.project.project?.name) errors.push("project.project.name is required");
  if (!cfg.project.execution) errors.push("project.execution is required");
  if (!cfg.routing.default) errors.push("routing.default is required");
  if (!cfg.models.providers) errors.push("models.providers is required");
  if (!cfg.models.capabilityCandidates) errors.push("models.capabilityCandidates is required");

  const promptIds = new Set(Object.keys(cfg.prompts.prompts || {}));
  const workflowIds = new Set(Object.keys(cfg.workflows.workflows || {}));
  const providerIds = new Set(Object.keys(cfg.models.providers || {}));

  for (const [task, route] of Object.entries(cfg.routing.routes || {})) {
    const pid = asId(route.prompt || cfg.routing.default?.prompt);
    const wid = asId(route.workflow || cfg.routing.default?.workflow);
    if (!promptIds.has(pid)) errors.push(`route '${task}' references missing prompt '${pid}'`);
    if (!workflowIds.has(wid)) errors.push(`route '${task}' references missing workflow '${wid}'`);
    if (!Number.isFinite(Number(route.qualityGate))) warnings.push(`route '${task}' has no explicit qualityGate`);
  }

  for (const [tier, candidates] of Object.entries(cfg.models.capabilityCandidates || {})) {
    if (!Array.isArray(candidates) || !candidates.length) errors.push(`capability tier '${tier}' has no candidates`);
    for (const candidate of candidates || []) {
      if (!providerIds.has(candidate.provider)) errors.push(`candidate '${tier}' references missing provider '${candidate.provider}'`);
      if (!candidate.model) errors.push(`candidate '${tier}' has no model`);
    }
  }

  if (cfg.models.providers?.local?.enabled !== true) warnings.push("local provider should remain enabled for deterministic tests");
  if (cfg.models.providers?.notdiamond?.enabled === true) {
    warnings.push("Not Diamond is enabled; verify project-specific eval readiness before relying on learned routing.");
  }

  return { valid: errors.length === 0, errors, warnings };
}
