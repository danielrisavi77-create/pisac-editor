import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runGoldenEval } from "../src/evaluator.mjs";

const root = resolve(import.meta.dirname, "../../..");

test("all deterministic golden routing cases pass", async () => {
  const result = await runGoldenEval(root);
  assert.equal(result.failedCount, 0, JSON.stringify(result.results.filter((x) => !x.passed), null, 2));
  assert.equal(result.passed, true);
});
