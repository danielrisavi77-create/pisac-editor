import { extractResponseText, fetchProviderJson, normalizeUsage } from "./base.mjs";

const BASE="https://api.x.ai/v1";
export function createXAIProvider(config={},runtime={}){
  const env=runtime.env||process.env,fetchImpl=runtime.fetchImpl||globalThis.fetch;
  const key=()=>env[config.keyEnv||"XAI_API_KEY"];
  return{
    id:"xai",supportsExactTokenCount:false,
    available(){return config.enabled!==false&&Boolean(key());},
    async countTokens(){return{inputTokens:null,method:"heuristic-required",exactUnavailable:true};},
    async execute({model,system,user,plan}){
      if(!key())throw new Error("XAI_API_KEY is not configured.");
      const body={
        model,input:String(user||""),store:false,
        ...(system?{instructions:String(system)}:{}),
        ...(plan?.outputBudgetTokens?{max_output_tokens:plan.outputBudgetTokens}:{}),
        ...(["low","medium","high","xhigh"].includes(plan?.reasoning)?{reasoning:{effort:plan.reasoning}}:{})
      };
      const started=Date.now();
      const data=await fetchProviderJson({
        provider:"xai",operation:"generate",url:config.endpoint||BASE+"/responses",
        headers:{Authorization:`Bearer ${key()}`},body,
        timeoutMs:plan?.budgets?.maxLatencyMs||30000,fetchImpl
      });
      const u=data.usage||{},cached=u.input_tokens_details?.cached_tokens||0,output=u.output_tokens||0,reasoning=u.output_tokens_details?.reasoning_tokens??null,ticks=Number(u.cost_in_usd_ticks);
      const providerCostUsd=Number.isFinite(ticks)?ticks/1e10:null;
      const usage=normalizeUsage({
        inputTokens:u.input_tokens||0,cachedInputTokens:cached,
        uncachedInputTokens:Math.max(0,(u.input_tokens||0)-cached),
        outputTokens:output,visibleOutputTokens:reasoning==null?null:Math.max(0,output-reasoning),
        reasoningTokens:reasoning,totalTokens:u.total_tokens,providerCostUsd
      });
      return{
        provider:"xai",requestedModel:model,actualModel:data.model||model,
        output:typeof data.output_text==="string"?data.output_text:extractResponseText(data.output),
        usage,costUsd:providerCostUsd,costStatus:providerCostUsd==null?"unknown":"verified-actual",
        latencyMs:Date.now()-started
      };
    }
  };
}
