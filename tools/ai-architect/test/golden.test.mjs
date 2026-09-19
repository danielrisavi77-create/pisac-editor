import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { recommend } from "../src/router.mjs";

const root = resolve(import.meta.dirname, "../../..");
const golden = JSON.parse(await readFile(resolve(root, ".ai/evals/golden.json"), "utf8"));

for (const c of golden.cases) {
  test(`golden route: ${c.id}`, async () => {
    const r = await recommend(c.input, root);
    assert.equal(r.task, c.expectedTask);
    assert.equal(r.recommendation.workflow, c.expectedWorkflow);
    assert.ok(r.recommendation.qualityGate >= c.minQualityGate);
  });
}
