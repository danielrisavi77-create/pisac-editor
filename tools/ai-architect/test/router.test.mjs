import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { classifyTask, estimateComplexity, estimateRisk } from "../src/classify.mjs";
import { recommend, explainPlan } from "../src/router.mjs";

const root = resolve(import.meta.dirname, "../../..");

test("citation verification requires verification intent plus citation signal", () => {
  assert.equal(classifyTask("Verify every citation and DOI in this academic paper"), "citation_verification");
  assert.equal(classifyTask("This paragraph mentions several sources."), "generic");
});

test("research remains distinct from citation verification", () => {
  assert.equal(classifyTask("Istraži literaturu i pronađi relevantne izvore"), "research");
  assert.equal(classifyTask("Provjeri citate i izvore iz bibliografije"), "citation_verification");
});

test("UI purpose can provide a task hint", () => {
  assert.equal(classifyTask("Uredi ovo", { purpose:"language" }), "grammar");
  assert.equal(classifyTask("Napravi ovo", { purpose:"translate" }), "translation");
});

test("high-risk citation plan fails closed on missing evidence", async () => {
  const plan = await recommend("Provjeri sve citate i DOI u cijelom radu", root);
  assert.equal(plan.task, "citation_verification");
  assert.equal(plan.risk, "high");
  assert.equal(plan.workflow.id, "retrieve-verify-judge");
  assert.equal(plan.retrieval.required, true);
  assert.equal(plan.retrieval.evidenceProvided, false);
  assert.equal(plan.verification.required, true);
});

test("plan exposes separate workflow, prompt, tools, model and budgets", async () => {
  const plan = await recommend("Implementiraj API i napiši testove", root);
  assert.equal(plan.task, "coding");
  assert.equal(plan.prompt.id, "code-change");
  assert.ok(Array.isArray(plan.workflow.steps));
  assert.ok(Array.isArray(plan.tools));
  assert.ok(Array.isArray(plan.modelSelection.candidates));
  assert.ok(plan.budgets.maxLatencyMs > 0);
  assert.ok(plan.contextBudget.maxChars > 0);
});

test("public explanation is a decision rationale, not hidden reasoning", async () => {
  const plan = await recommend("Jezično doradi ovaj tekst", root);
  const explanation = explainPlan(plan);
  assert.ok(explanation.summary.includes("Task class"));
  assert.ok(explanation.reasons.length >= 4);
});

test("complexity stays within 1..5", () => {
  const c = estimateComplexity("Full repo production architecture and release workflow", "architecture");
  assert.ok(c >= 1 && c <= 5);
});

test("risk recognizes security", () => {
  assert.equal(estimateRisk("Review auth token security", "security_review"), "high");
});
