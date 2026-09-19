import { fetchProviderJson, normalizeUsage } from "./base.mjs";

const BASE="https://api.anthropic.com/v1";
const VERSION="2023-06-01";

function buildBody({model,system,user,plan,includeMax=true}){
  const body={
    model,
    messages:[{role:"user",content:[{type:"text",text:String(user||"")}]}],
    cache_control:{type:"ephemeral",ttl:plan?.cacheTtl==="1h"?"1h":"5m"}
  };
  if(system)body.system=[{type:"text",text:String(system)}];
  if(includeMax)body.max_tokens=plan?.outputBudgetTokens||4096;
  if(!String(model).includes("haiku-4-5")){
    body.thinking={type:"adaptive"};
    if(["low","medium","high","xhigh","max"].includes(plan?.reasoning))body.output_config={effort:plan.reasoning};
  }
  return body;
}

export function createAnthropicProvider(config={},runtime={}){
  const env=runtime.env||process.env,fetchImpl=runtime.fetchImpl||globalThis.fetch;
  const key=()=>env[config.keyEnv||"ANTHROPIC_API_KEY"];
  const headers=()=>({"x-api-key":key(),"anthropic-version":config.apiVersion||VERSION});
  return{
    id:"anthropic",supportsExactTokenCount:true,
    available(){return config.enabled!==false&&Boolean(key());},
    async countTokens({model,system,user,plan}){
      if(!key())throw new Error("ANTHROPIC_API_KEY is not configured.");
      const data=await fetchProviderJson({
        provider:"anthropic",operation:"count_tokens",url:config.countEndpoint||BASE+"/messages/count_tokens",
        headers:headers(),body:buildBody({model,system,user,plan,includeMax:false}),
        timeoutMs:plan?.budgets?.maxLatencyMs||30000,fetchImpl
      });
      return{inputTokens:Number(data.input_tokens)||0,method:"provider-exact"};
    },
    async execute({model,system,user,plan}){
      if(!key())throw new Error("ANTHROPIC_API_KEY is not configured.");
      const started=Date.now();
      const data=await fetchProviderJson({
        provider:"anthropic",operation:"generate",url:config.endpoint||BASE+"/messages",
        headers:headers(),body:buildBody({model,system,user,plan,includeMax:true}),
        timeoutMs:plan?.budgets?.maxLatencyMs||30000,fetchImpl
      });
      const u=data.usage||{},cacheWrite=u.cache_creation_input_tokens||0,cacheRead=u.cache_read_input_tokens||0,uncached=u.input_tokens||0,output=u.output_tokens||0;
      const reasoning=u.output_tokens_details?.thinking_tokens??null;
      return{
        provider:"anthropic",requestedModel:model,actualModel:data.model||model,
        output:(data.content||[]).filter(x=>x?.type==="text").map(x=>x.text).join("\n"),
        usage:normalizeUsage({
          inputTokens:uncached+cacheWrite+cacheRead,uncachedInputTokens:uncached,cachedInputTokens:cacheRead,cacheWriteTokens:cacheWrite,
          outputTokens:output,visibleOutputTokens:reasoning==null?null:Math.max(0,output-reasoning),reasoningTokens:reasoning
        }),
        costUsd:null,costStatus:"derived-after-usage",latencyMs:Date.now()-started
      };
    }
  };
}
