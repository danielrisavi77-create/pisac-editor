import test from "node:test";
import assert from "node:assert/strict";
import { fetchProviderJson } from "../src/providers/base.mjs";
import { createOpenRouterProvider } from "../src/providers/openrouter.mjs";
import { createOpenAIProvider } from "../src/providers/openai.mjs";
import { createAnthropicProvider } from "../src/providers/anthropic.mjs";
import { createGeminiProvider } from "../src/providers/gemini.mjs";
import { createXAIProvider } from "../src/providers/xai.mjs";
import { validateOutput } from "../src/validate-output.mjs";

function json(value,status=200,headers={}){return new Response(typeof value==="string"?value:JSON.stringify(value),{status,headers:{"content-type":"application/json",...headers}});}

test("provider HTTP errors are sanitized and expose transient metadata",async()=>{
  await assert.rejects(fetchProviderJson({
    provider:"openai",operation:"generate",url:"https://provider.test",body:{},
    fetchImpl:async()=>json({error:{message:"sk-super-secret-provider-message"}},429,{"retry-after":"2"})
  }),error=>{
    assert.equal(error.status,429);assert.equal(error.code,"PROVIDER_RATE_LIMITED");assert.equal(error.transient,true);
    assert.equal(error.retryAfterMs,2000);assert.equal(error.message.includes("super-secret"),false);return true;
  });
});
test("provider timeout becomes transient ProviderError",async()=>{
  await assert.rejects(fetchProviderJson({
    provider:"gemini",operation:"generate",url:"https://provider.test",body:{},timeoutMs:5,
    fetchImpl:async(_url,options)=>new Promise((_r,reject)=>options.signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true}))
  }),error=>error.code==="PROVIDER_TIMEOUT"&&error.transient===true);
});
test("malformed successful OpenRouter response becomes empty and fails structural validation",async()=>{
  const provider=createOpenRouterProvider({enabled:true,keyEnv:"OPENROUTER_API_KEY"},{env:{OPENROUTER_API_KEY:"x"},fetchImpl:async()=>json("not-json")});
  const result=await provider.execute({model:"openrouter/auto",system:"s",user:"u",plan:{capabilityTier:"low",outputBudgetTokens:100,budgets:{maxLatencyMs:1000}}});
  assert.equal(result.output,"");assert.equal(validateOutput(result.output,{task:"generic"}).passed,false);
});
test("OpenRouter Auto maps actual route, billed cost and cost tier",async()=>{
  let body;
  const provider=createOpenRouterProvider({enabled:true,keyEnv:"OPENROUTER_API_KEY"},{env:{OPENROUTER_API_KEY:"x"},fetchImpl:async(_u,o)=>{
    body=JSON.parse(o.body);return json({model:"openai/gpt-5.6-sol",choices:[{message:{content:"ok"}}],usage:{prompt_tokens:12,completion_tokens:7,total_tokens:19,cost:0.004}});
  }});
  const result=await provider.execute({model:"openrouter/auto",system:"s",user:"u",plan:{capabilityTier:"critical",outputBudgetTokens:123,budgets:{maxLatencyMs:1000}}});
  assert.equal(body.plugins[0].cost_tier,"max");assert.equal(result.actualModel,"openai/gpt-5.6-sol");
  assert.equal(result.usage.inputTokens,12);assert.equal(result.usage.outputTokens,7);assert.equal(result.costUsd,0.004);assert.equal(result.costStatus,"verified-actual");
});
test("OpenAI supports exact input count and rich Responses usage",async()=>{
  const calls=[];
  const provider=createOpenAIProvider({enabled:true,keyEnv:"OPENAI_API_KEY"},{env:{OPENAI_API_KEY:"x"},fetchImpl:async(url,o)=>{
    calls.push({url,body:JSON.parse(o.body)});
    if(url.endsWith("/responses/input_tokens"))return json({input_tokens:44});
    return json({model:"gpt-5.6-sol",output:[{content:[{type:"output_text",text:"ok"}]}],usage:{input_tokens:20,input_tokens_details:{cached_tokens:3,cache_write_tokens:2},output_tokens:8,output_tokens_details:{reasoning_tokens:2},total_tokens:28}});
  }});
  const counted=await provider.countTokens({model:"gpt-5.6-sol",system:"s",user:"u",plan:{budgets:{maxLatencyMs:1000}}});
  const result=await provider.execute({model:"gpt-5.6-sol",system:"s",user:"u",plan:{reasoning:"high",outputBudgetTokens:321,budgets:{maxLatencyMs:1000}}});
  assert.equal(counted.inputTokens,44);assert.equal(calls[1].body.max_output_tokens,321);assert.deepEqual(calls[1].body.reasoning,{effort:"high"});
  assert.equal(result.usage.cachedInputTokens,3);assert.equal(result.usage.cacheWriteTokens,2);assert.equal(result.usage.reasoningTokens,2);assert.equal(result.usage.visibleOutputTokens,6);
});
test("Anthropic exact count and cache accounting stay provider-specific",async()=>{
  const calls=[];
  const provider=createAnthropicProvider({enabled:true,keyEnv:"ANTHROPIC_API_KEY"},{env:{ANTHROPIC_API_KEY:"x"},fetchImpl:async(url,o)=>{
    calls.push({url,body:JSON.parse(o.body)});
    if(url.endsWith("/count_tokens"))return json({input_tokens:50});
    return json({model:"claude-opus-5",content:[{type:"text",text:"ok"}],usage:{input_tokens:20,cache_creation_input_tokens:4,cache_read_input_tokens:6,output_tokens:10,output_tokens_details:{thinking_tokens:3}}});
  }});
  assert.equal((await provider.countTokens({model:"claude-opus-5",system:"s",user:"u",plan:{reasoning:"high",budgets:{maxLatencyMs:1000}}})).inputTokens,50);
  const result=await provider.execute({model:"claude-opus-5",system:"s",user:"u",plan:{reasoning:"high",outputBudgetTokens:456,budgets:{maxLatencyMs:1000}}});
  assert.deepEqual(calls[1].body.output_config,{effort:"high"});assert.equal(result.usage.inputTokens,30);assert.equal(result.usage.cachedInputTokens,6);assert.equal(result.usage.cacheWriteTokens,4);
});
test("Gemini uses countTokens and thinkingLevel without deprecated sampling parameters",async()=>{
  const calls=[];
  const provider=createGeminiProvider({enabled:true,keyEnv:"GEMINI_API_KEY"},{env:{GEMINI_API_KEY:"x"},fetchImpl:async(url,o)=>{
    calls.push({url,body:JSON.parse(o.body)});
    if(url.includes(":countTokens"))return json({totalTokens:41,cachedContentTokenCount:5});
    return json({modelVersion:"gemini-3.8-flash",candidates:[{content:{parts:[{text:"ok"}]}}],usageMetadata:{promptTokenCount:14,cachedContentTokenCount:2,candidatesTokenCount:9,thoughtsTokenCount:4,totalTokenCount:27}});
  }});
  const count=await provider.countTokens({model:"gemini-3.8-flash",system:"s",user:"u",plan:{budgets:{maxLatencyMs:1000}}});
  const result=await provider.execute({model:"gemini-3.8-flash",system:"s",user:"u",plan:{reasoning:"high",outputBudgetTokens:222,budgets:{maxLatencyMs:1000}}});
  assert.equal(count.inputTokens,41);assert.equal(calls[1].body.generationConfig.temperature,undefined);
  assert.deepEqual(calls[1].body.generationConfig.thinkingConfig,{thinkingLevel:"high"});assert.equal(result.usage.outputTokens,13);assert.equal(result.usage.reasoningTokens,4);
});
test("xAI keeps preflight heuristic but uses provider-reported billed cost ticks",async()=>{
  const provider=createXAIProvider({enabled:true,keyEnv:"XAI_API_KEY"},{env:{XAI_API_KEY:"x"},fetchImpl:async()=>json({
    model:"grok-4.6",output:[{content:[{type:"output_text",text:"ok"}]}],
    usage:{input_tokens:10,output_tokens:5,total_tokens:15,cost_in_usd_ticks:25000000}
  })});
  assert.equal((await provider.countTokens()).exactUnavailable,true);
  const result=await provider.execute({model:"grok-4.6",system:"s",user:"u",plan:{reasoning:"high",outputBudgetTokens:100,budgets:{maxLatencyMs:1000}}});
  assert.equal(result.costUsd,0.0025);assert.equal(result.costStatus,"verified-actual");
});
