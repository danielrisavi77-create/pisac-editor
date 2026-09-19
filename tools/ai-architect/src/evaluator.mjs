import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { recommend } from "./router.mjs";

export async function runGoldenEval(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, ".ai", "evals", "golden.json");
  const golden = JSON.parse(await readFile(path, "utf8"));
  const results = [];

  for (const c of golden.cases || []) {
    const plan = await recommend(c.input, repoRoot, c.context || {});
    const checks = [];
    if (c.expectedTask) checks.push({ field:"task", passed:plan.task === c.expectedTask, actual:plan.task, expected:c.expectedTask });
    if (c.expectedWorkflow) checks.push({ field:"workflow", passed:plan.workflow.id === c.expectedWorkflow, actual:plan.workflow.id, expected:c.expectedWorkflow });
    if (c.expectedPrompt) checks.push({ field:"prompt", passed:plan.prompt.id === c.expectedPrompt, actual:plan.prompt.id, expected:c.expectedPrompt });
    if (c.retrievalRequired != null) checks.push({ field:"retrieval.required", passed:plan.retrieval.required === c.retrievalRequired, actual:plan.retrieval.required, expected:c.retrievalRequired });
    if (c.verificationRequired != null) checks.push({ field:"verification.required", passed:plan.verification.required === c.verificationRequired, actual:plan.verification.required, expected:c.verificationRequired });
    if (c.minQualityGate != null) checks.push({ field:"qualityGate", passed:plan.qualityGate >= c.minQualityGate, actual:plan.qualityGate, expected:`>=${c.minQualityGate}` });
    results.push({
      id:c.id,
      passed:checks.every((x) => x.passed),
      checks
    });
  }

  return {
    passed:results.every((r) => r.passed),
    total:results.length,
    passedCount:results.filter((r) => r.passed).length,
    failedCount:results.filter((r) => !r.passed).length,
    results
  };
}
