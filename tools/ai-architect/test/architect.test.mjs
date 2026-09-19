import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { AIArchitect } from "../src/architect.mjs";

const root = resolve(import.meta.dirname, "../../..");

test("execute works offline through explicit mock provider for low-risk tasks", async () => {
  const outcomes = [];
  const architect = new AIArchitect({
    repoRoot:root,
    env:{},
    allowMock:true,
    outcomeSink:async (row) => outcomes.push(row)
  });

  const result = await architect.execute("Jezično doradi ovu rečenicu.", {
    purpose:"language",
    feature:"assistant",
    mockResponse:"Akademski dorađena rečenica."
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "local");
  assert.equal(result.actualModel, "local/mock");
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].privacy.outputChars, result.output.length);
  assert.equal("outputText" in outcomes[0], false);
});

test("retrieval-required tasks are blocked before any model call when evidence is absent", async () => {
  const architect = new AIArchitect({repoRoot:root,env:{},allowMock:true});
  const result = await architect.execute("Istraži literaturu o obveznom glasanju.", {
    feature:"assistant",
    mockResponse:"This must never be used."
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "RETRIEVAL_REQUIRED");
  assert.equal(result.attempts.length, 0);
});

test("high-risk task cannot silently succeed without an independent verifier", async () => {
  const outcomes = [];
  const architect = new AIArchitect({
    repoRoot:root,
    env:{},
    allowMock:true,
    outcomeSink:async (row) => outcomes.push(row)
  });

  const result = await architect.execute("Provjeri ovaj citat i DOI.", {
    feature:"assistant",
    retrievedEvidence:[{title:"Source",source:"test",excerpt:"Evidence"}],
    mockResponse:"Status: unresolved."
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "VERIFICATION_UNAVAILABLE");
  assert.ok(result.attempts.length >= 1);
  assert.equal(outcomes.at(-1).success, false);
});

test("explicit degraded fallback stays non-success", async () => {
  const architect = new AIArchitect({repoRoot:root,env:{},allowMock:false,outcomeSink:async()=>{}});
  const result = await architect.execute("Jezično doradi ovu rečenicu.", {
    purpose:"language",
    allowDegraded:true,
    degradedOutput:"Demo odgovor."
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "degraded");
  assert.equal(result.output, "Demo odgovor.");
});
