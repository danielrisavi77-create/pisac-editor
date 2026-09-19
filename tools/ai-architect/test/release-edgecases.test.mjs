import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { AIArchitect } from "../src/architect.mjs";

const root=resolve(import.meta.dirname,"../../..");

function json(value,status=200){
  return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
}

function chat(model,content,cost=0.001){
  return json({
    model,
    choices:[{message:{content}}],
    usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15,cost}
  });
}

test("429 retries the same candidate before succeeding", async () => {
  const seen=[];
  const outcomes=[];
  let calls=0;
  const architect=new AIArchitect({
    repoRoot:root,
    env:{OPENROUTER_API_KEY:"test-key"},
    fetchImpl:async (_url,options)=>{
      const body=JSON.parse(options.body); seen.push(body.model); calls++;
      if(calls===1) return json({error:"rate"},429);
      return chat(body.model,"ok");
    },
    outcomeSink:async row=>outcomes.push(row)
  });
  const result=await architect.execute("Jezično doradi rečenicu.",{purpose:"language"});
  assert.equal(result.ok,true);
  assert.equal(seen[0],"openrouter/auto");
  assert.equal(seen[1],"openrouter/auto");
  assert.equal(outcomes.length,1);
});

test("500 retries the same candidate", async () => {
  const seen=[];
  let calls=0;
  const architect=new AIArchitect({
    repoRoot:root,
    env:{OPENROUTER_API_KEY:"test-key"},
    fetchImpl:async (_url,options)=>{
      const body=JSON.parse(options.body); seen.push(body.model); calls++;
      if(calls===1) return json({error:"upstream"},500);
      return chat(body.model,"ok");
    },
    outcomeSink:async()=>{}
  });
  const result=await architect.execute("Jezično doradi rečenicu.",{purpose:"language"});
  assert.equal(result.ok,true);
  assert.equal(seen[0],seen[1]);
});

test("non-retryable 400 moves to the next candidate instead of retrying the same one", async () => {
  const seen=[];
  const architect=new AIArchitect({
    repoRoot:root,
    env:{OPENROUTER_API_KEY:"test-key"},
    fetchImpl:async (_url,options)=>{
      const body=JSON.parse(options.body); seen.push(body.model);
      if(body.model==="openrouter/auto") return json({error:"bad request"},400);
      return chat(body.model,"ok");
    },
    outcomeSink:async()=>{}
  });
  const result=await architect.execute("Jezično doradi rečenicu.",{purpose:"language"});
  assert.equal(result.ok,true);
  assert.equal(seen.filter(x=>x==="openrouter/auto").length,1);
  assert.notEqual(seen[1],"openrouter/auto");
});

test("AbortError is treated as timeout and retried", async () => {
  let first=true;
  const seen=[];
  const architect=new AIArchitect({
    repoRoot:root,
    env:{OPENROUTER_API_KEY:"test-key"},
    fetchImpl:async (_url,options)=>{
      const body=JSON.parse(options.body); seen.push(body.model);
      if(first){ first=false; throw new DOMException("Aborted","AbortError"); }
      return chat(body.model,"ok");
    },
    outcomeSink:async()=>{}
  });
  const result=await architect.execute("Jezično doradi rečenicu.",{purpose:"language"});
  assert.equal(result.ok,true);
  assert.equal(seen[0],seen[1]);
});

test("independent verifier skips a different route that resolves to the same actual model", async () => {
  const calls=[];
  const architect=new AIArchitect({
    repoRoot:root,
    env:{OPENROUTER_API_KEY:"test-key"},
    fetchImpl:async (_url,options)=>{
      const body=JSON.parse(options.body);
      const verifier=body.messages?.[0]?.content?.startsWith("You are an independent verifier.");
      calls.push({requested:body.model,verifier});
      if(!verifier) return chat("openai/gpt-5.6-sol","Primary answer.");
      if(body.model==="anthropic/claude-opus-5") return chat("gpt-5.6-sol","VERDICT: PASS\nSame model route.");
      return chat("google/gemini-3.8-flash","VERDICT: PASS\nIndependent.");
    },
    outcomeSink:async()=>{}
  });
  const result=await architect.execute("Provjeri ovaj citat i DOI.",{
    retrievedEvidence:[{title:"Evidence",source:"test",excerpt:"Support"}]
  });
  assert.equal(result.ok,true);
  assert.equal(result.verification.actualModel,"google/gemini-3.8-flash");
  assert.ok(result.verification.attempts.some(x=>x.sameActualModel===true));
});

test("explicit verifier FAIL cannot produce success", async () => {
  const outcomes=[];
  const architect=new AIArchitect({
    repoRoot:root,
    env:{OPENROUTER_API_KEY:"test-key"},
    fetchImpl:async (_url,options)=>{
      const body=JSON.parse(options.body);
      const verifier=body.messages?.[0]?.content?.startsWith("You are an independent verifier.");
      return verifier
        ? chat(body.model,"VERDICT: FAIL\nUnsupported.")
        : chat(body.model,"Primary answer.");
    },
    outcomeSink:async row=>outcomes.push(row)
  });
  const result=await architect.execute("Provjeri ovaj citat i DOI.",{
    retrievedEvidence:[{title:"Evidence",source:"test",excerpt:"Support"}]
  });
  assert.equal(result.ok,false);
  assert.equal(result.code,"VERIFICATION_FAILED");
  assert.equal(outcomes.length,1);
  assert.equal(outcomes[0].success,false);
});

test("final no-provider failure records exactly one outcome", async () => {
  const outcomes=[];
  const architect=new AIArchitect({
    repoRoot:root,
    env:{},
    outcomeSink:async row=>outcomes.push(row)
  });
  const result=await architect.execute("Jezično doradi rečenicu.",{purpose:"language"});
  assert.equal(result.ok,false);
  assert.equal(result.code,"NO_PROVIDER_AVAILABLE");
  assert.equal(outcomes.length,1);
  assert.equal(outcomes[0].failureReason,"NO_PROVIDER_AVAILABLE");
});
