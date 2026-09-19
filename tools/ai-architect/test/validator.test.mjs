import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { validateConfig } from "../src/validator.mjs";

const root = resolve(import.meta.dirname, "../../..");

test("v0.2 configuration is internally consistent", async () => {
  const result = await validateConfig(root);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.errors, []);
});
