import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadArchitectConfig(repoRoot = process.cwd()) {
  const aiRoot = resolve(repoRoot, ".ai");
  const [project, routing, models, prompts, workflows] = await Promise.all([
    readJson(resolve(aiRoot, "project.json")),
    readJson(resolve(aiRoot, "routing.json")),
    readJson(resolve(aiRoot, "models.json")),
    readJson(resolve(aiRoot, "prompts.json")),
    readJson(resolve(aiRoot, "workflows.json"))
  ]);
  return { aiRoot, project, routing, models, prompts, workflows };
}

export function getVersionedEntry(registry, id, fallbackId) {
  const entry = registry?.[id] || registry?.[fallbackId];
  if (!entry) throw new Error(`Missing registry entry: ${id}`);
  if (typeof entry === "string" || Array.isArray(entry)) {
    return { id, version: "1.0.0", value: entry };
  }
  return {
    id,
    version: entry.version || "1.0.0",
    value: entry.template ?? entry.steps ?? entry.value ?? entry
  };
}
