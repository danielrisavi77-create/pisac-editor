import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { AIArchitect } from "../src/architect.mjs";
import { NoopOutcomeStore } from "../src/outcome-store.mjs";

const root=resolve(import.meta.dirname,"../../..");
function json(v,status=200){return new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json"}});}
function orChat(model,text,cost=.001){return json({model,choices:[{message:{content:text}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15,cost}});}
const dynamic={budget:{allowDynamicPricing:true,allowUnknownPredictedCost:true}};

test("transient 429 retries the exact same OpenRouter route",async()=>{
  const seen=[];let n=0;
  const a=new AIArchitect({repoRoot:root,env:{OPENROUTER_API_KEY:"x"},outcomeStore:new NoopOutcomeStore(),fetchImpl:async(_u,o)=>{
    const b=JSON.parse(o.body);seen.push(b.model);n++;if(n===1)return json({error:"rate"},429);return orChat(b.model,"ok");
  }});
  const result=await a.execute("Jezično doradi rečenicu.",{purpose:"language",...dynamic});
  assert.equal(result.ok,true);assert.deepEqual(seen,["openrouter/auto","openrouter/auto"]);assert.equal(result.retries,1);assert.equal(result.fallbacks,0);
});
test("nontransient primary failure falls back to a different provider",async()=>{
  const calls=[];
  const a=new AIArchitect({repoRoot:root,env:{OPENAI_API_KEY:"x",ANTHROPIC_API_KEY:"x"},outcomeStore:new NoopOutcomeStore(),fetchImpl:async(url,o)=>{
    const b=JSON.parse(o.body);calls.push({url,model:b.model});
    if(url.includes("responses/input_tokens"))return json({input_tokens:30});
    if(url.includes("api.openai.com/v1/responses"))return json({error:"bad"},400);
    if(url.includes("count_tokens"))return json({input_tokens:30});
    return json({model:b.model,content:[{type:"text",text:"fallback ok"}],usage:{input_tokens:10,output_tokens:5}});
  }});
  const result=await a.execute("Jezično doradi rečenicu.",{purpose:"language"});
  assert.equal(result.ok,true);assert.equal(result.provider,"anthropic");assert.equal(result.fallbacks,1);assert.equal(result.retries,0);
});
test("contract failure escalates to a stronger capability route",async()=>{
  const calls=[];
  const a=new AIArchitect({repoRoot:root,env:{OPENAI_API_KEY:"x",ANTHROPIC_API_KEY:"x"},outcomeStore:new NoopOutcomeStore(),fetchImpl:async(url,o)=>{
    const b=JSON.parse(o.body);calls.push({url,model:b.model});
    if(url.includes("responses/input_tokens"))return json({input_tokens:20});
    if(url.includes("count_tokens"))return json({input_tokens:20});
    if(url.includes("api.openai.com/v1/responses"))return json({model:b.model,output:[],usage:{input_tokens:10,output_tokens:0,total_tokens:10}});
    return json({model:b.model,content:[{type:"text",text:"escalated answer"}],usage:{input_tokens:10,output_tokens:5}});
  }});
  const result=await a.execute("Jezično doradi rečenicu.",{purpose:"language"});
  assert.equal(result.ok,true);assert.equal(result.provider,"anthropic");assert.equal(result.escalations,1);assert.equal(result.fallbacks,0);
});
test("hard max-cost budget rejects unknown/dynamic predicted cost unless explicitly allowed",async()=>{
  const a=new AIArchitect({repoRoot:root,env:{OPENROUTER_API_KEY:"x"},outcomeStore:new NoopOutcomeStore(),fetchImpl:async()=>orChat("openai/gpt-5.6-sol","must not run")});
  const result=await a.execute("Jezično doradi rečenicu.",{purpose:"language",budget:{allowDynamicPricing:true,allowUnknownPredictedCost:false}});
  assert.equal(result.ok,false);assert.equal(result.code,"NO_PROVIDER_AVAILABLE");
});
test("high-risk task cannot succeed without a distinct actual-model verifier",async()=>{
  const a=new AIArchitect({repoRoot:root,env:{OPENAI_API_KEY:"x"},outcomeStore:new NoopOutcomeStore(),fetchImpl:async(url,o)=>{
    const b=JSON.parse(o.body);
    if(url.includes("input_tokens"))return json({input_tokens:30});
    return json({model:"gpt-5.6-sol",output:[{content:[{type:"output_text",text:b.input?.includes?.("Independent")?"VERDICT: PASS":"Primary answer"}]}],usage:{input_tokens:10,output_tokens:5,total_tokens:15}});
  }});
  const result=await a.execute("Provjeri ovaj citat i DOI.",{retrievedEvidence:[{title:"Evidence",source:"test",excerpt:"Support"}]});
  assert.equal(result.ok,false);assert.ok(["VERIFICATION_UNAVAILABLE","NO_PROVIDER_AVAILABLE"].includes(result.code));
});
