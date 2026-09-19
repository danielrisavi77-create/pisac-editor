import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { validateConfig } from "../src/validator.mjs";
const root=resolve(import.meta.dirname,"../../..");
test("v0.3 configuration and canonical registry are internally consistent",async()=>{
  const result=await validateConfig(root);assert.equal(result.valid,true,JSON.stringify(result.errors,null,2));assert.deepEqual(result.errors,[]);
  assert.equal(result.registry.valid,true);assert.ok(result.registry.count>=10);
});
