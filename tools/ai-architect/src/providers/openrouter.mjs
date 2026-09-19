import { fetchProviderJson, normalizeUsage } from "./base.mjs";

export function createOpenRouterProvider(config={},runtime={}){
  const env=runtime.env||process.env,fetchImpl=runtime.fetchImpl||globalThis.fetch;
  const key=()=>env[config.keyEnv||"OPENROUTER_API_KEY"];
  return{
    id:"openrouter",supportsExactTokenCount:false,
    available(){return config.enabled!==false&&Boolean(key());},
    async countTokens(){return{inputTokens:null,method:"heuristic-required",exactUnavailable:true};},
    async execute({model,system,user,plan}){
      if(!key())throw new Error("OPENROUTER_API_KEY is not configured.");
      const body={
        model,
        messages:[{role:"system",content:system},{role:"user",content:user}],
        ...(model==="openrouter/auto"?{plugins:[{id:"auto-router",cost_tier:({low:"low",medium:"medium",high:"high",critical:"max"})[plan?.capabilityTier]||"medium"}]}:{}),
        ...(plan?.outputBudgetTokens?{max_tokens:plan.outputBudgetTokens}:{})
      };
      const started=Date.now();
      const data=await fetchProviderJson({
        provider:"openrouter",operation:"generate",url:config.endpoint||"https://openrouter.ai/api/v1/chat/completions",
        headers:{
          Authorization:`Bearer ${key()}`,
          "HTTP-Referer":env.AI_ARCHITECT_SITE_URL||"https://github.com/danielrisavi77-create/pisac-editor",
          "X-Title":env.AI_ARCHITECT_APP_NAME||"AI Architect"
        },
        body,timeoutMs:plan?.budgets?.maxLatencyMs||30000,fetchImpl
      });
      const u=data.usage||{},cost=Number(u.cost);
      const usage=normalizeUsage({
        inputTokens:u.prompt_tokens,outputTokens:u.completion_tokens,totalTokens:u.total_tokens,
        providerCostUsd:Number.isFinite(cost)?cost:null
      });
      return{
        provider:"openrouter",requestedModel:model,actualModel:data.model||model,
        output:data.choices?.[0]?.message?.content??"",usage,
        costUsd:usage.providerCostUsd,costStatus:usage.providerCostUsd==null?"unknown":"verified-actual",
        latencyMs:Date.now()-started
      };
    }
  };
}
