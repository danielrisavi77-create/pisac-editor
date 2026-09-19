export function resolvePricing(model,inputTokens,cacheTtl="5m"){
  if(!model?.pricing) return null;
  const base=model.pricing;
  const long=base.longContext;
  const inLong=Boolean(long&&Number(inputTokens)>Number(long.thresholdTokens));
  let input=base.inputUsdPerM;
  let cached=base.cachedInputUsdPerM??input;
  let output=base.outputUsdPerM;
  let write=cacheTtl==="1h"?base.cacheWrite1hUsdPerM:(base.cacheWrite5mUsdPerM??base.cacheWriteUsdPerM);
  if(inLong){
    if(long.inputUsdPerM!=null) input=long.inputUsdPerM;
    else if(long.inputMultiplier) input*=long.inputMultiplier;
    if(long.cachedInputUsdPerM!=null) cached=long.cachedInputUsdPerM;
    else if(long.cachedInputMultiplier) cached*=long.cachedInputMultiplier;
    else if(long.inputMultiplier) cached*=long.inputMultiplier;
    if(long.outputUsdPerM!=null) output=long.outputUsdPerM;
    else if(long.outputMultiplier) output*=long.outputMultiplier;
    if(write!=null){
      if(long.cacheWriteUsdPerM!=null) write=long.cacheWriteUsdPerM;
      else if(long.cacheWriteMultiplier) write*=long.cacheWriteMultiplier;
      else if(long.inputMultiplier) write*=long.inputMultiplier;
    }
  }
  return {inputUsdPerM:input,cachedInputUsdPerM:cached,cacheWriteUsdPerM:write,outputUsdPerM:output,inLongContext:inLong,longContextThreshold:long?.thresholdTokens||null};
}

export function estimateRequestCost({model,inputTokens,tokenBudget,cachedInputTokens=0,cacheWriteTokens=0,percentile="p90",cacheTtl="5m"}={}){
  const rates=resolvePricing(model,inputTokens,cacheTtl);
  if(!rates) return {status:"unknown",source:"dynamic-or-unknown-pricing",totalUsd:null,inputUsd:null,outputUsd:null,rates:null,percentile};
  const cached=Math.min(Math.max(0,Number(cachedInputTokens)||0),Number(inputTokens)||0);
  const writes=Math.min(Math.max(0,Number(cacheWriteTokens)||0),Math.max(0,(Number(inputTokens)||0)-cached));
  const uncached=Math.max(0,(Number(inputTokens)||0)-cached-writes);
  const writeRate=rates.cacheWriteUsdPerM??rates.inputUsdPerM;
  const billedOutput=tokenBudget?.billedOutput?.[percentile]??tokenBudget?.billedOutput?.p90??0;
  const inputCost=uncached/1e6*rates.inputUsdPerM+cached/1e6*rates.cachedInputUsdPerM+writes/1e6*writeRate;
  const outputCost=billedOutput/1e6*rates.outputUsdPerM;
  return {status:"predicted",source:"catalog-estimate",totalUsd:round6(inputCost+outputCost),inputUsd:round6(inputCost),outputUsd:round6(outputCost),rates,percentile};
}

export function estimateCostEnvelope(args={}){
  const expected=estimateRequestCost(args);
  if(expected.totalUsd==null) return {expected,budgetCeilingUsd:null,coldCacheCeiling:null};
  const rates=resolvePricing(args.model,args.inputTokens,args.cacheTtl||"5m");
  const cold=rates?.cacheWriteUsdPerM!=null
    ? estimateRequestCost({...args,cacheWriteTokens:args.inputTokens,cachedInputTokens:0})
    : expected;
  return {expected,budgetCeilingUsd:Math.max(expected.totalUsd,cold.totalUsd??expected.totalUsd),coldCacheCeiling:cold};
}

export function calculateActualCost(model,usage={},options={}){
  // `Number(null)` is 0, so an absent provider-reported cost must be rejected
  // explicitly: unknown actual cost is never a verified zero.
  if(usage.providerCostUsd!=null&&usage.providerCostUsd!==""&&Number.isFinite(Number(usage.providerCostUsd))){
    return {status:"verified-actual",totalUsd:round6(Number(usage.providerCostUsd)),source:"provider-reported-billed"};
  }
  const rates=resolvePricing(model,usage.inputTokens||0,options.cacheTtl||"5m");
  if(!rates) return {status:"unknown",totalUsd:null,source:"pricing-unknown"};
  const totalInput=Math.max(0,Number(usage.inputTokens)||0);
  const cached=Math.min(Math.max(0,Number(usage.cachedInputTokens)||0),totalInput);
  const writes=Math.min(Math.max(0,Number(usage.cacheWriteTokens)||0),Math.max(0,totalInput-cached));
  const uncached=Number.isFinite(Number(usage.uncachedInputTokens))?Math.max(0,Number(usage.uncachedInputTokens)):Math.max(0,totalInput-cached-writes);
  const writeRate=rates.cacheWriteUsdPerM??rates.inputUsdPerM;
  const inputCost=uncached/1e6*rates.inputUsdPerM+cached/1e6*rates.cachedInputUsdPerM+writes/1e6*writeRate;
  const outputCost=(Number(usage.outputTokens)||0)/1e6*rates.outputUsdPerM;
  return {status:"derived-actual-token-cost",totalUsd:round6(inputCost+outputCost),source:"catalog-rates-from-actual-usage",rates};
}
export function round6(v){return Math.round(Number(v)*1e6)/1e6;}
