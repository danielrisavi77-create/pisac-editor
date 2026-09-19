import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { scanRepo } from "../src/scanner.mjs";

const root = resolve(import.meta.dirname, "../../..");

test("ProjectProfile detects Pisač product and infrastructure signals", async () => {
  const profile = await scanRepo(root);
  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.project.staticWeb, true);
  assert.equal(profile.project.academicDomain, true);
  assert.equal(profile.ai.uiPresent, true);
  assert.equal(profile.ai.provenanceTracking, true);
  assert.equal(profile.deployment.netlify, true);
  assert.equal(profile.productSignals.studentMode, true);
  assert.equal(profile.productSignals.mentorMode, true);
  assert.ok(profile.testing.testFiles.length > 0);
  assert.ok(profile.instructions.documentationFiles.includes("README.md"));
});

test("ProjectProfile does not report obvious embedded API secrets", async () => {
  const profile = await scanRepo(root);
  assert.equal(profile.security.clientSecretRiskSignal, false);
});
