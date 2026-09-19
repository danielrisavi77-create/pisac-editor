import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeOutcome, outcomeKey, normalizedUtility } from "../src/outcomes.mjs";

test("outcome telemetry stores hashes and lengths, not task/output content", () => {
  const clean = sanitizeOutcome({
    project:"pisac-editor",
    feature:"assistant",
    taskClass:"grammar",
    taskText:"Sensitive student text",
    outputText:"Rewritten sensitive text",
    workflow:{id:"direct",version:"2.0.0"},
    prompt:{id:"academic-writing",version:"2.0.0"},
    provider:"openrouter",
    requestedModel:"openrouter/auto",
    actualModel:"google/gemini-3.8-flash",
    reasoningLevel:"low",
    usage:{inputTokens:20,outputTokens:10,totalTokens:30},
    qualityScore:0.95,
    success:true
  });
  assert.equal("taskText" in clean, false);
  assert.equal("outputText" in clean, false);
  assert.equal(clean.privacy.taskChars, 22);
  assert.equal(clean.privacy.outputChars, 24);
  assert.equal(clean.privacy.taskHash.length, 64);
  assert.equal(clean.eligibleForLearning, true);
});

test("unevaluated runtime outcomes cannot influence adaptive utility", () => {
  const clean = sanitizeOutcome({
    taskClass:"grammar",
    workflow:{id:"direct",version:"2.0.0"},
    prompt:{id:"academic-writing",version:"2.0.0"},
    success:true
  });
  assert.equal(clean.qualityScore, null);
  assert.equal(clean.utility, null);
  assert.equal(clean.eligibleForLearning, false);
});

test("quality score is required before cost can affect utility", () => {
  assert.equal(normalizedUtility({qualityScore:null,costUsd:0,success:true}), null);
  assert.ok(normalizedUtility({qualityScore:0.95,costUsd:0.01,latencyMs:1000,usage:{totalTokens:1000},success:true}) > 0);
});

test("outcome key includes versioned workflow and prompt plus actual model", () => {
  const key = outcomeKey({
    taskClass:"coding",
    workflow:{id:"plan",version:"2"},
    prompt:{id:"code",version:"3"},
    provider:"openrouter",
    actualModel:"model-a",
    reasoningLevel:"high",
    tools:["tests.run"]
  });
  assert.equal(key, "coding|plan@2|code@3|openrouter|model-a|high|tests.run");
});
