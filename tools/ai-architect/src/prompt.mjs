import { loadArchitectConfig, getVersionedEntry } from "./config.mjs";

function refId(ref, fallback) {
  return typeof ref === "string" ? ref : ref?.id || fallback;
}

export async function loadPrompt(ref, repoRoot = process.cwd()) {
  const config = await loadArchitectConfig(repoRoot);
  const id = refId(ref, "general");
  const entry = getVersionedEntry(config.prompts.prompts, id, "general");
  return { id, version: entry.version, text: String(entry.value) };
}

export async function loadWorkflow(ref, repoRoot = process.cwd()) {
  const config = await loadArchitectConfig(repoRoot);
  const id = refId(ref, "direct");
  const entry = getVersionedEntry(config.workflows.workflows, id, "direct");
  const steps = Array.isArray(entry.value) ? entry.value : entry.value?.steps || [];
  return { id, version: entry.version, steps };
}
