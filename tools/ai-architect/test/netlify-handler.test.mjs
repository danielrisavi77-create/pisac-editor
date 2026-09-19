import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, config } from "../../../netlify/functions/ai-execute.mjs";

const url="https://pisac.example/api/ai";
const originalLive=process.env.AI_ARCHITECT_LIVE_ENABLED;
const originalUsage=process.env.AI_ARCHITECT_USAGE_POLICY_READY;

function req(body,{origin="https://pisac.example",method="POST"}={}){
  return new Request(url,{method,headers:{...(origin===null?{}:{origin}),"content-type":"application/json"},...(method==="POST"?{body:JSON.stringify(body)}:{})});
}
function enable(){process.env.AI_ARCHITECT_LIVE_ENABLED="true";process.env.AI_ARCHITECT_USAGE_POLICY_READY="true";}
test.after(()=>{
  if(originalLive===undefined)delete process.env.AI_ARCHITECT_LIVE_ENABLED;else process.env.AI_ARCHITECT_LIVE_ENABLED=originalLive;
  if(originalUsage===undefined)delete process.env.AI_ARCHITECT_USAGE_POLICY_READY;else process.env.AI_ARCHITECT_USAGE_POLICY_READY=originalUsage;
});

test("Netlify config exposes POST-only rate-limited canonical /api/ai route",()=>{
  assert.equal(config.path,"/api/ai");assert.equal(config.method,"POST");
  assert.equal(config.rateLimit.windowLimit,10);assert.deepEqual(config.rateLimit.aggregateBy,["ip","domain"]);
});
test("live endpoint disabled returns safe 503 before execution",async()=>{
  process.env.AI_ARCHITECT_LIVE_ENABLED="false";process.env.AI_ARCHITECT_USAGE_POLICY_READY="false";
  let calls=0;const response=await createHandler({execute:async()=>{calls++;}})(req({prompt:"x",purpose:"language"}));
  assert.equal(response.status,503);assert.equal((await response.json()).code,"LIVE_AI_DISABLED");assert.equal(calls,0);
});
test("usage policy readiness is a second live kill switch",async()=>{
  process.env.AI_ARCHITECT_LIVE_ENABLED="true";process.env.AI_ARCHITECT_USAGE_POLICY_READY="false";
  let calls=0;const response=await createHandler({execute:async()=>{calls++;}})(req({prompt:"x",purpose:"language"}));
  assert.equal(response.status,503);assert.equal((await response.json()).code,"USAGE_POLICY_NOT_READY");assert.equal(calls,0);
});
test("missing or cross-origin requests are rejected",async()=>{
  enable();const handler=createHandler({execute:async()=>{throw new Error("must not execute");}});
  for(const origin of [null,"https://evil.example"]){
    const response=await handler(req({prompt:"x",purpose:"language"},{origin}));
    assert.equal(response.status,403);assert.equal((await response.json()).code,"ORIGIN_NOT_ALLOWED");
  }
});
test("invalid purpose and oversized prompts fail before execution",async()=>{
  enable();let calls=0;const handler=createHandler({execute:async()=>{calls++;}});
  let response=await handler(req({prompt:"x",purpose:"unsupported"}));
  assert.equal(response.status,400);assert.equal((await response.json()).code,"INVALID_PURPOSE");
  response=await handler(req({prompt:"x".repeat(12001),purpose:"language"}));
  assert.equal(response.status,400);assert.equal((await response.json()).code,"INVALID_PROMPT");assert.equal(calls,0);
});
test("mock Architect exercises successful handler contract without paid API",async()=>{
  enable();
  const handler=createHandler({execute:async()=>({
    ok:true,output:"Mock output",provider:"local",requestedModel:"local/mock",actualModel:"local/mock",
    verification:{status:"not-required"},retries:0,fallbacks:0,escalations:0,costStatus:"aggregate-known",
    plan:{workflow:{id:"direct",version:"2.0.0"},prompt:{id:"academic-writing",version:"2.0.0"},reasoning:"low"}
  })});
  const response=await handler(req({prompt:"Jezično doradi.",purpose:"language",selectedText:"Tekst"}));
  const body=await response.json();assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.output,"Mock output");
  assert.equal(body.execution.status,"live");assert.equal(body.execution.escalationCount,0);
});
