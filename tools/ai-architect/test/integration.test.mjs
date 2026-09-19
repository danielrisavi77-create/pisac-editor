import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const root=resolve(import.meta.dirname,"../../..");

test("public browser assets contain no server API secret names",async()=>{
  const files=["public/legacy/index.html","public/legacy/assets/app.js","public/legacy/assets/ai-client.js"];
  const corpus=(await Promise.all(files.map(p=>readFile(resolve(root,p),"utf8")))).join("\n");
  for(const name of ["OPENROUTER_API_KEY","OPENAI_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY","XAI_API_KEY","NOTDIAMOND_API_KEY","SUPABASE_SERVICE_ROLE_KEY"]){
    assert.equal(corpus.includes(name),false,`public asset leaked server secret identifier ${name}`);
  }
});
test("assistant uses one canonical AI Architect endpoint and explicit demo fallback",async()=>{
  const app=await readFile(resolve(root,"public/legacy/assets/app.js"),"utf8");
  const client=await readFile(resolve(root,"public/legacy/assets/ai-client.js"),"utf8");
  const fn=await readFile(resolve(root,"netlify/functions/ai-execute.mjs"),"utf8");
  assert.ok(app.includes("window.PisacAI.ask"));assert.ok(app.includes('status:"demo_fallback"'));assert.ok(app.includes("Demo odgovor"));
  assert.ok(client.includes("/api/ai"));assert.equal(client.includes("/api/ai-router"),false);
  assert.ok(fn.includes("AI_ARCHITECT_LIVE_ENABLED"));assert.ok(fn.includes("AI_ARCHITECT_USAGE_POLICY_READY"));assert.ok(fn.includes('path:"/api/ai"'));assert.ok(fn.includes("rateLimit"));
});
test("Netlify bundle includes Architect config/core and no ai-router redirect",async()=>{
  const toml=await readFile(resolve(root,"netlify.toml"),"utf8");
  assert.ok(toml.includes('".ai/**"'));assert.ok(toml.includes('"tools/ai-architect/**"'));assert.equal(toml.includes("/api/ai-router"),false);
});
test("superseded active AI Router V1 surfaces are removed",async()=>{
  for(const path of [".github/workflows/ai-router.yml","netlify/functions/ai-router.mjs","src/ai-router/service.mjs"]){
    await assert.rejects(access(resolve(root,path)));
  }
  // The root manifest may exist again, but only as a delegation shim: it must carry no
  // Router V1 test/benchmark surface of its own.
  const rootPkg=JSON.parse(await readFile(resolve(root,"package.json"),"utf8"));
  assert.equal(JSON.stringify(rootPkg).includes("ai-router"),false);
  const rootScripts=Object.keys(rootPkg.scripts||{});
  assert.equal(rootScripts.some(name=>name.includes("router")),false);
  assert.ok(rootScripts.includes("test"));
  const architectScript=Object.values(rootPkg.scripts||{}).find(cmd=>String(cmd).includes("tools/ai-architect"));
  assert.ok(architectScript,"root manifest must delegate a test script to the AI Architect suite");
  await access(resolve(root,"supabase/migrations/2026091901_ai_router_v1.sql")); // legacy migration history only
  await access(resolve(root,"supabase/migrations/2026091903_ai_architect_v03.sql"));
});
test("AI integration preserves core Pisač editor regression markers",async()=>{
  const app=await readFile(resolve(root,"public/legacy/assets/app.js"),"utf8"),html=await readFile(resolve(root,"public/legacy/index.html"),"utf8");
  for(const marker of ['id="m-student"','id="m-mentor"'])assert.ok(html.includes(marker),marker);
  for(const marker of ["function chainHash(","function verifyChain(",'originKind:"unattributed"','insertAtEnd(l.response,"ai_insert"','push("ai_accept"', "navigator.clipboard.writeText(l.response)",'push("comment_add"','push("cite_insert"',"function insertCitation(","function seed()",'ledger.push({id:"AI1"'])assert.ok(app.includes(marker),marker);
});
