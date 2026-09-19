export const EXECUTION_PROFILES = Object.freeze({
  fast:{costWeight:0.35,latencyWeight:1,reliabilityWeight:0.45,capabilityFloor:1,maxRetries:1,maxFallbacks:1,maxEscalations:0},
  economy:{costWeight:1,latencyWeight:0.2,reliabilityWeight:0.55,capabilityFloor:1,maxRetries:1,maxFallbacks:1,maxEscalations:1},
  balanced:{costWeight:0.7,latencyWeight:0.4,reliabilityWeight:0.85,capabilityFloor:2,maxRetries:1,maxFallbacks:2,maxEscalations:1},
  quality:{costWeight:0.35,latencyWeight:0.2,reliabilityWeight:1,capabilityFloor:3,maxRetries:1,maxFallbacks:2,maxEscalations:1},
  critical:{costWeight:0.15,latencyWeight:0.1,reliabilityWeight:1.25,capabilityFloor:4,maxRetries:2,maxFallbacks:2,maxEscalations:2}
});

function finiteOrNull(value){
  if(value===null||value===undefined||value==="") return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function nonNegativeInt(value,fallback){
  const n=Number(value);
  return Number.isInteger(n)&&n>=0?n:fallback;
}
function uniqueArray(value){
  return Array.isArray(value)&&value.length?[...new Set(value.map(String))]:null;
}

export function normalizeBudget(input={},profileName="balanced"){
  const profile=EXECUTION_PROFILES[profileName]||EXECUTION_PROFILES.balanced;
  return {
    maxCostUsd:finiteOrNull(input.maxCostUsd),
    maxInputTokens:finiteOrNull(input.maxInputTokens),
    maxOutputTokens:finiteOrNull(input.maxOutputTokens),
    maxTotalTokens:finiteOrNull(input.maxTotalTokens),
    maxLatencyMs:finiteOrNull(input.maxLatencyMs),
    minQuality:finiteOrNull(input.minQuality),
    requireEmpiricalQuality:Boolean(input.requireEmpiricalQuality),
    maxRetries:nonNegativeInt(input.maxRetries,profile.maxRetries),
    maxFallbacks:nonNegativeInt(input.maxFallbacks,profile.maxFallbacks),
    maxEscalations:nonNegativeInt(input.maxEscalations,profile.maxEscalations),
    allowProviders:uniqueArray(input.allowProviders),
    denyProviders:uniqueArray(input.denyProviders),
    allowPreviewModels:input.allowPreviewModels!==false,
    allowDynamicPricing:Boolean(input.allowDynamicPricing),
    allowUnknownPredictedCost:Boolean(input.allowUnknownPredictedCost)
  };
}

export function checkCandidateBudget(candidate,budget){
  const reasons=[];
  if(budget.allowProviders&&!budget.allowProviders.includes(candidate.provider)) reasons.push("provider_not_allowed");
  if(budget.denyProviders?.includes(candidate.provider)) reasons.push("provider_denied");
  if(!budget.allowPreviewModels&&candidate.stability==="preview") reasons.push("preview_model_denied");
  if(candidate.dynamicPricing&&!budget.allowDynamicPricing) reasons.push("dynamic_pricing_denied");
  const predicted=candidate.predictedCost?.budgetCeilingUsd;
  if(budget.maxCostUsd!=null){
    if(predicted==null&&!budget.allowUnknownPredictedCost) reasons.push("predicted_cost_unknown");
    else if(predicted!=null&&predicted>budget.maxCostUsd) reasons.push("max_cost_exceeded");
  }
  if(budget.maxInputTokens!=null&&candidate.inputTokens>budget.maxInputTokens) reasons.push("max_input_tokens_exceeded");
  if(budget.maxOutputTokens!=null&&candidate.tokenBudget?.billedOutput?.p95>budget.maxOutputTokens) reasons.push("max_output_tokens_exceeded");
  if(budget.maxTotalTokens!=null&&candidate.inputTokens+(candidate.tokenBudget?.billedOutput?.p95||0)>budget.maxTotalTokens) reasons.push("max_total_tokens_exceeded");
  if(budget.requireEmpiricalQuality&&candidate.quality?.source!=="production-empirical") reasons.push("empirical_quality_unavailable");
  if(budget.minQuality!=null){
    if(candidate.quality?.successProbability==null) reasons.push("min_quality_unverifiable");
    else if(candidate.quality.successProbability<budget.minQuality) reasons.push("min_quality_not_met");
  }
  return reasons;
}

export function newBudgetLedger(budget={},startedAt=Date.now()){
  return {
    budget,
    startedAt,
    actual:{costUsd:0,inputTokens:0,outputTokens:0,totalTokens:0,latencyMs:0},
    unknownCost:false,
    retries:0,
    fallbacks:0,
    escalations:0,
    attempts:0
  };
}

export function remainingBudget(ledger,now=Date.now()){
  const b=ledger.budget||{};
  const elapsed=now-ledger.startedAt;
  return {
    costUsd:b.maxCostUsd==null||ledger.unknownCost?null:Math.max(0,b.maxCostUsd-ledger.actual.costUsd),
    inputTokens:b.maxInputTokens==null?null:Math.max(0,b.maxInputTokens-ledger.actual.inputTokens),
    outputTokens:b.maxOutputTokens==null?null:Math.max(0,b.maxOutputTokens-ledger.actual.outputTokens),
    totalTokens:b.maxTotalTokens==null?null:Math.max(0,b.maxTotalTokens-ledger.actual.totalTokens),
    latencyMs:b.maxLatencyMs==null?null:Math.max(0,b.maxLatencyMs-elapsed),
    retries:Math.max(0,(b.maxRetries??0)-ledger.retries),
    fallbacks:Math.max(0,(b.maxFallbacks??0)-ledger.fallbacks),
    escalations:Math.max(0,(b.maxEscalations??0)-ledger.escalations)
  };
}

export function assertNextAttemptFits({ledger,candidate,predictedCostUsd,inputTokens,outputTokens,now=Date.now()}){
  const b=ledger.budget||{};
  if(b.maxLatencyMs!=null&&now-ledger.startedAt>=b.maxLatencyMs) throw budgetError("LATENCY_BUDGET_EXCEEDED");
  if(b.maxCostUsd!=null){
    if(ledger.unknownCost) throw budgetError("ACTUAL_COST_UNKNOWN");
    if(predictedCostUsd==null&&!b.allowUnknownPredictedCost) throw budgetError("PREDICTED_COST_UNKNOWN");
    if(predictedCostUsd!=null&&ledger.actual.costUsd+predictedCostUsd>b.maxCostUsd) throw budgetError("AGGREGATE_COST_BUDGET_EXCEEDED");
  }
  if(b.maxInputTokens!=null&&ledger.actual.inputTokens+inputTokens>b.maxInputTokens) throw budgetError("AGGREGATE_INPUT_BUDGET_EXCEEDED");
  if(b.maxOutputTokens!=null&&ledger.actual.outputTokens+outputTokens>b.maxOutputTokens) throw budgetError("AGGREGATE_OUTPUT_BUDGET_EXCEEDED");
  if(b.maxTotalTokens!=null&&ledger.actual.totalTokens+inputTokens+outputTokens>b.maxTotalTokens) throw budgetError("AGGREGATE_TOKEN_BUDGET_EXCEEDED");
  return true;
}

export function noteAttemptKind(ledger,kind="initial"){
  ledger.attempts+=1;
  if(kind==="retry")ledger.retries+=1;
  if(kind==="fallback")ledger.fallbacks+=1;
  if(kind==="escalation")ledger.escalations+=1;
  return ledger;
}

export function applyAttemptUsage(ledger,{usage={},costUsd=null,latencyMs=0}={}){
  const input=Number(usage.inputTokens)||0;
  const output=Number(usage.outputTokens)||0;
  ledger.actual.inputTokens+=input;
  ledger.actual.outputTokens+=output;
  ledger.actual.totalTokens+=Number(usage.totalTokens)||input+output;
  ledger.actual.latencyMs+=Number(latencyMs)||0;
  if(costUsd==null||!Number.isFinite(Number(costUsd))) ledger.unknownCost=true;
  else ledger.actual.costUsd+=Number(costUsd);
  return ledger;
}

export function canUseAttemptKind(ledger,kind){
  const b=ledger.budget||{};
  if(kind==="retry") return ledger.retries<(b.maxRetries??0);
  if(kind==="fallback") return ledger.fallbacks<(b.maxFallbacks??0);
  if(kind==="escalation") return ledger.escalations<(b.maxEscalations??0);
  return true;
}

function budgetError(code){
  const error=new Error(code);
  error.code=code;
  error.status=422;
  return error;
}
