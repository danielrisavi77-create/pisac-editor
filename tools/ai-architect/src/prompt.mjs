import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadPrompt(name, repoRoot = process.cwd()) {
  const registry = JSON.parse(
    await readFile(resolve(repoRoot, ".ai", "prompts.json"), "utf8")
  );
  return registry.prompts?.[name] || registry.prompts?.general || "";
}

export async function loadWorkflow(name, repoRoot = process.cwd()) {
  const registry = JSON.parse(
    await readFile(resolve(repoRoot, ".ai", "workflows.json"), "utf8")
  );
  return registry.workflows?.[name] || registry.workflows?.direct || ["execute"];
}
