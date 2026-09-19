import { fetchProviderJson, normalizeUsage } from "./base.mjs";

const BASE="https://generativelanguage.googleapis.com/v1beta/models";
function payload(system,user){
  const body={contents:[{role:"user",parts:[{text:String(user||"")}]}]};
  if(system)body.systemInstruction={parts:[{text:String(system)}]};
  return body;
}
export function createGeminiProvider(config={},runtime={}){
  const env=runtime.env||process.env,fetchImpl=runtime.fetchImpl||globalThis.fetch;
  const key=()=>env[config.keyEnv||"GEMINI_API_KEY"];
  const base=config.endpointBase||BASE;
  return{
    id:"gemini",supportsExactTokenCount:true,
    available(){return config.enabled!==false&&Boolean(key());},
    async countTokens({model,system,user,plan}){
      if(!key())throw new Error("GEMINI_API_KEY is not configured.");
      const data=await fetchProviderJson({
        provider:"gemini",operation:"count_tokens",url:`${base}/${encodeURIComponent(model)}:countTokens`,
        headers:{"x-goog-api-key":key()},body:payload(system,user),
        timeoutMs:plan?.budgets?.maxLatencyMs||30000,fetchImpl
      });
      return{inputTokens:Number(data.totalTokens)||0,cachedInputTokens:Number(data.cachedContentTokenCount)||0,method:"provider-exact"};
    },
    async execute({model,system,user,plan}){
      if(!key())throw new Error("GEMINI_API_KEY is not configured.");
      const body=payload(system,user);
      body.generationConfig={maxOutputTokens:plan?.outputBudgetTokens||4096};
      if(["minimal","low","medium","high"].includes(plan?.reasoning))body.generationConfig.thinkingConfig={thinkingLevel:plan.reasoning};
      const started=Date.now();
      const data=await fetchProviderJson({
        provider:"gemini",operation:"generate",url:`${base}/${encodeURIComponent(model)}:generateContent`,
        headers:{"x-goog-api-key":key()},body,
        timeoutMs:plan?.budgets?.maxLatencyMs||30000,fetchImpl
      });
      const u=data.usageMetadata||{},visible=u.candidatesTokenCount||0,reasoning=u.thoughtsTokenCount||0,input=u.promptTokenCount||0,cached=u.cachedContentTokenCount||0;
      const output=(data.candidates?.[0]?.content?.parts||[]).filter(x=>typeof x.text==="string"&&!x.thought).map(x=>x.text).join("\n");
      return{
        provider:"gemini",requestedModel:model,actualModel:data.modelVersion||model,output,
        usage:normalizeUsage({
          inputTokens:input,uncachedInputTokens:Math.max(0,input-cached),cachedInputTokens:cached,
          outputTokens:visible+reasoning,visibleOutputTokens:visible,reasoningTokens:reasoning,
          toolTokens:u.toolUsePromptTokenCount||0,totalTokens:u.totalTokenCount
        }),
        costUsd:null,costStatus:"derived-after-usage",latencyMs:Date.now()-started
      };
    }
  };
}
