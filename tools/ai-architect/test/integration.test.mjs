import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

test("public browser assets contain no server API secret names", async () => {
  const files = [
    "public/index.html",
    "public/assets/app.js",
    "public/assets/ai-client.js"
  ];
  const corpus = (await Promise.all(files.map((p) => readFile(resolve(root,p),"utf8")))).join("\n");
  for (const name of ["OPENROUTER_API_KEY","OPENAI_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY","NOTDIAMOND_API_KEY"]) {
    assert.equal(corpus.includes(name), false, `public asset leaked server secret identifier ${name}`);
  }
});

test("assistant uses central server execution and labels demo fallback explicitly", async () => {
  const app = await readFile(resolve(root,"public/assets/app.js"),"utf8");
  const client = await readFile(resolve(root,"public/assets/ai-client.js"),"utf8");
  const fn = await readFile(resolve(root,"netlify/functions/ai-execute.mjs"),"utf8");
  assert.ok(app.includes("window.PisacAI.ask"));
  assert.ok(app.includes('status:"demo_fallback"'));
  assert.ok(app.includes("Demo odgovor"));
  assert.ok(client.includes("/api/ai"));
  assert.ok(fn.includes("new AIArchitect"));
  assert.ok(fn.includes('feature:"assistant"'));
  assert.ok(fn.includes("AI_ARCHITECT_LIVE_ENABLED"));
  assert.ok(fn.includes('path:"/api/ai"'));
  assert.ok(fn.includes("rateLimit"));
});

test("Netlify function bundle explicitly includes dynamic Architect config files", async () => {
  const toml = await readFile(resolve(root,"netlify.toml"),"utf8");
  assert.ok(toml.includes('directory = "netlify/functions"'));
  assert.ok(toml.includes('node_bundler = "esbuild"'));
  assert.ok(toml.includes('".ai/**"'));
  assert.ok(toml.includes('"tools/ai-architect/**"'));
});
