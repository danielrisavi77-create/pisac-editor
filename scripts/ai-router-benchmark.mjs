import fs from "node:fs/promises";
import { previewAiRequest } from "../src/ai-router/service.mjs";

const cases = JSON.parse(await fs.readFile(new URL("../benchmarks/ai-router-cases.json", import.meta.url), "utf8"));
const rows = [];
let failures = 0;

for (const item of cases) {
  const result = previewAiRequest({
    profile: item.profile,
    prompt: item.prompt,
    context: item.context,
    requirements: item.requirements || {}
  }, {});
  const passed = result.analysis.taskType === item.expectedTaskType && Boolean(result.routing.recommended);
  if (!passed) failures += 1;
  rows.push({
    id: item.id,
    taskType: result.analysis.taskType,
    expectedTaskType: item.expectedTaskType,
    provider: result.routing.recommended?.provider || null,
    model: result.routing.recommended?.model || null,
    effort: result.routing.recommended?.effort || null,
    estimatedP90CostUsd: result.routing.recommended?.estimatedCost?.totalUsd ?? null,
    tokenSource: result.routing.recommended?.tokenBudget?.source || null,
    qualitySource: result.routing.recommended?.quality?.source || null,
    passed
  });
}

console.log(JSON.stringify({ benchmark: "offline-deterministic", cases: rows.length, failures, rows }, null, 2));
if (failures) process.exitCode = 1;
