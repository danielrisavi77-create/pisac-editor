import test from "node:test";
import assert from "node:assert/strict";
import { classifyTask, estimateComplexity, estimateRisk } from "../src/classify.mjs";
import { recommend, utility } from "../src/router.mjs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

test("classifies citation verification", () => {
  assert.equal(classifyTask("Verify every citation and DOI in this academic paper"), "citation_verification");
});

test("classifies coding", () => {
  assert.equal(classifyTask("Implement a TypeScript API and add tests"), "coding");
});

test("high-risk citation route requires verification", async () => {
  const r = await recommend("Provjeri sve citate i DOI u cijelom radu", root);
  assert.equal(r.task, "citation_verification");
  assert.equal(r.risk, "high");
  assert.equal(r.recommendation.needsIndependentVerification, true);
  assert.equal(r.recommendation.workflow, "retrieve-verify-judge");
});

test("complexity stays within 1..5", () => {
  const c = estimateComplexity("Full repo production architecture and release workflow", "architecture");
  assert.ok(c >= 1 && c <= 5);
});

test("risk recognizes security", () => {
  assert.equal(estimateRisk("Review auth token security", "security_review"), "high");
});

test("utility rewards quality and penalizes failure", () => {
  const good = utility({quality:0.95,cost:0.1,latency:0.1,tokens:0.1,failed:false});
  const failed = utility({quality:0.95,cost:0.1,latency:0.1,tokens:0.1,failed:true});
  assert.ok(good > failed);
});
