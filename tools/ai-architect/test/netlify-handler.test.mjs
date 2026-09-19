import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, config } from "../../../netlify/functions/ai-execute.mjs";

const url="https://pisac.example/api/ai";
const original=process.env.AI_ARCHITECT_LIVE_ENABLED;

function req(body,{origin="https://pisac.example",method="POST"}={}){
  return new Request(url,{
    method,
    headers:{
      ...(origin===null?{}:{origin}),
      "content-type":"application/json"
    },
    ...(method==="POST"?{body:JSON.stringify(body)}:{})
  });
}

test.after(()=> {
  if(original===undefined) delete process.env.AI_ARCHITECT_LIVE_ENABLED;
  else process.env.AI_ARCHITECT_LIVE_ENABLED=original;
});

test("Netlify config exposes POST-only rate-limited /api/ai route",()=>{
  assert.equal(config.path,"/api/ai");
  assert.equal(config.method,"POST");
  assert.equal(config.rateLimit.windowLimit,10);
  assert.deepEqual(config.rateLimit.aggregateBy,["ip","domain"]);
});

test("live endpoint disabled returns safe 503 before execution",async()=>{
  process.env.AI_ARCHITECT_LIVE_ENABLED="false";
  let calls=0;
  const handler=createHandler({execute:async()=>{calls++;}});
  const response=await handler(req({prompt:"x",purpose:"language"}));
  const body=await response.json();
  assert.equal(response.status,503);
  assert.equal(body.code,"LIVE_AI_DISABLED");
  assert.equal(calls,0);
});

test("missing or cross-origin requests are rejected",async()=>{
  process.env.AI_ARCHITECT_LIVE_ENABLED="true";
  const handler=createHandler({execute:async()=>{throw new Error("must not execute");}});
  for(const origin of [null,"https://evil.example"]){
    const response=await handler(req({prompt:"x",purpose:"language"},{origin}));
    const body=await response.json();
    assert.equal(response.status,403);
    assert.equal(body.code,"ORIGIN_NOT_ALLOWED");
  }
});

test("invalid purpose is rejected without provider execution",async()=>{
  process.env.AI_ARCHITECT_LIVE_ENABLED="true";
  let calls=0;
  const handler=createHandler({execute:async()=>{calls++;}});
  const response=await handler(req({prompt:"x",purpose:"unsupported"}));
  assert.equal(response.status,400);
  assert.equal((await response.json()).code,"INVALID_PURPOSE");
  assert.equal(calls,0);
});

test("oversized prompt is rejected without provider execution",async()=>{
  process.env.AI_ARCHITECT_LIVE_ENABLED="true";
  let calls=0;
  const handler=createHandler({execute:async()=>{calls++;}});
  const response=await handler(req({prompt:"x".repeat(12001),purpose:"language"}));
  assert.equal(response.status,400);
  assert.equal((await response.json()).code,"INVALID_PROMPT");
  assert.equal(calls,0);
});

test("mock Architect can exercise successful handler contract without a paid API call",async()=>{
  process.env.AI_ARCHITECT_LIVE_ENABLED="true";
  const handler=createHandler({
    execute:async()=>({
      ok:true,
      output:"Mock output",
      provider:"local",
      requestedModel:"local/mock",
      actualModel:"local/mock",
      validation:{passed:true},
      verification:{status:"not-required"},
      plan:{
        workflow:{id:"direct",version:"2.0.0"},
        prompt:{id:"academic-writing",version:"2.0.0"},
        reasoning:"low"
      }
    })
  });
  const response=await handler(req({prompt:"Jezično doradi.",purpose:"language",selectedText:"Tekst"}));
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.ok,true);
  assert.equal(body.output,"Mock output");
  assert.equal(body.execution.status,"live");
});
