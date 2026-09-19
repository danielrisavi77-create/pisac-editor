import { extractResponseText, fetchProviderJson, normalizeUsage } from "./base.mjs";

const BASE="https://api.openai.com/v1";

function buildInput(user){
  return String(user||"");
}

export function createOpenAIProvider(config={},runtime={}){
  const env=runtime.env||process.env,fetchImpl=runtime.fetchImpl||globalThis.fetch;
  const key=()=>env[config.keyEnv||"OPENAI_API_KEY"];
  return {
    id:"openai",
    supportsExactTokenCount:true,
    available(){return config.enabled!==false&&Boolean(key());},
    async countTokens({model,system,user,plan}){
      if(!key())throw new Error("OPENAI_API_KEY is not configured.");
      const data=await fetchProviderJson({
        provider:"openai",operation:"count_tokens",
        url:config.countEndpoint||BASE+"/responses/input_tokens",
        headers:{Authorization:`Bearer ${key()}`},
        body:{model,input:buildInput(user),...(system?{instructions:system}:{} )},
        timeoutMs:plan?.budgets?.maxLatencyMs||30000,fetchImpl
      });
      return{inputTokens:Number(data.input_tokens)||0,method:"provider-exact"};
    },
    async execute({model,system,user,plan}){
      if(!key())throw new Error("OPENAI_API_KEY is not configured.");
      const body={model,input:buildInput(user),store:false,...(system?{instructions:system}:{}),...(plan?.outputBudgetTokens?{max_output_tokens:plan.outputBudgetTokens}:{})};
      if(plan?.reasoning&&plan.reasoning!=="none")body.reasoning={effort:plan.reasoning};
      const started=Date.now();
      const data=await fetchProviderJson({
        provider:"openai",operation:"generate",url:config.endpoint||BASE+"/responses",
        headers:{Authorization:`Bearer ${key()}`},body,
        timeoutMs:plan?.budgets?.maxLatencyMs||30000,fetchImpl
      });
      const u=data.usage||{},reasoning=u.output_tokens_details?.reasoning_tokens??0,output=u.output_tokens||0;
      const cached=u.input_tokens_details?.cached_tokens||0,write=u.input_tokens_details?.cache_write_tokens||0,input=u.input_tokens||0;
      return{
        provider:"openai",requestedModel:model,actualModel:data.model||model,
        output:typeof data.output_text==="string"?data.output_text:extractResponseText(data.output),
        usage:normalizeUsage({
          inputTokens:input,cachedInputTokens:cached,cacheWriteTokens:write,
          uncachedInputTokens:Math.max(0,input-cached-write),
          outputTokens:output,visibleOutputTokens:Math.max(0,output-reasoning),
          reasoningTokens:reasoning,totalTokens:u.total_tokens
        }),
        costUsd:null,costStatus:"derived-after-usage",latencyMs:Date.now()-started
      };
    }
  };
}
