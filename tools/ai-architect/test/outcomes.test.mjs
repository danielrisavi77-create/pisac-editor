import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOutcome, outcomeKey } from "../src/outcomes.mjs";

test("normalizes outcome metrics into 0..1", () => {
  const n = normalizeOutcome({quality:0.95,costUsd:0.05,latencyMs:15000,tokens:6000,success:true});
  assert.equal(n.quality,0.95);
  assert.equal(n.cost,0.5);
  assert.equal(n.latency,0.5);
  assert.equal(n.tokens,0.5);
  assert.equal(n.failed,false);
});

test("outcome key distinguishes route combinations", () => {
  assert.equal(
    outcomeKey({task:"coding",workflow:"plan",prompt:"code",model:"model-a"}),
    "coding|plan|code|model-a"
  );
});
