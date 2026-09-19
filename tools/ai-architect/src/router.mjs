import { classifyTask, estimateComplexity, estimateRisk } from "./classify.mjs";
import { loadArchitectConfig } from "./config.mjs";
import { loadPrompt, loadWorkflow } from "./prompt.mjs";
import { scanRepo } from "./scanner.mjs";
import { resolveModelRefs, getModel } from "./model-registry.mjs";
import { optimizeContext, roughInputTokens } from "./context-budget.mjs";
import { predictTokenBudget } from "./predictor.mjs";
import { estimateCostEnvelope } from "./pricing.mjs";
import { estimateQuality } from "./quality.mjs";
import { EXECUTION_PROFILES, checkCandidateBudget, normalizeBudget } from "./budget.mjs";

const CAPABILITY_FLOOR={low:1,medium:2,high:3,critical:4};
const EFFORT_RANK={"provider-default":1,none:0,minimal:.5,low:1,medium:2,high:3,xhigh:4,max:5};
const LATENCY_RANK={fastest:1,fast:2,medium:3,slow:4};

function mergedRoute(defaultRoute={},route={}){
  return{
    ...defaultRoute,...route,
    retrieval:{...(defaultRoute.retrieval||{}),...(route.retrieval||{})},
    verification:{...(defaultRoute.verification||{}),...(route.verification||{})},
    contextBudget:{...(defaultRoute.contextBudget||{}),...(route.contextBudget||{})},
    budgets:{...(defaultRoute.budgets||{}),...(route.budgets||{})},
    generation:{...(defaultRoute.generation||{}),...(route.generation||{})}
  };
}
function pickEffort(model,desired){
  const modes=model.reasoningModes?.length?model.reasoningModes:["provider-default"];
  if(modes.includes(desired))return desired;
  if(desired==="high"){
    for(const e of ["high","xhigh","max","medium","provider-default"])if(modes.includes(e))return e;
  }
  if(desired==="low"){
    for(const e of ["low","minimal","none","medium","provider-default"])if(modes.includes(e))return e;
  }
  for(const e of ["medium","high","low","provider-default",modes[0]])if(modes.includes(e))return e;
  return modes[0];
}
function calibrationKey(task,model,effort){return [task,model.provider,model.model,effort].join("|");}
function buildSegments(context={}){
  const segments=[];
  if(context.selectedText)segments.push({text:context.selectedText,type:"selected_text",source:"editor",priority:100});
  for(const item of context.retrievedEvidence||[])segments.push({
    text:[item.title,item.source,item.excerpt||item.text].filter(Boolean).join("\n"),
    type:"evidence",source:item.source||item.url||"retrieved",pinned:true,priority:1000
  });
  for(const item of context.contextSegments||[])if(item?.text)segments.push(item);
  return segments;
}
function cheapest(candidates,predicate){
  return candidates.filter(predicate).filter(c=>c.predictedCost?.expected?.totalUsd!=null)
    .sort((a,b)=>a.predictedCost.expected.totalUsd-b.predictedCost.expected.totalUsd)[0]||null;
}
function enrichExpectedCosts(candidates,verificationRequired){
  for(const candidate of candidates){
    if(candidate.quality.source!=="production-empirical")continue;
    const base=candidate.predictedCost.expected.totalUsd;
    if(base==null)continue;
    const retry=(candidate.quality.retryProbability??0)*base;
    const fallbackCandidate=cheapest(candidates,c=>c.provider!==candidate.provider&&c.capabilityRank>=candidate.capabilityRank);
    const fallback=(candidate.quality.fallbackProbability??0)*(fallbackCandidate?.predictedCost?.expected?.totalUsd||0);
    const escalationCandidate=cheapest(candidates,c=>c.capabilityRank>candidate.capabilityRank||(
      c.capabilityRank===candidate.capabilityRank&&(EFFORT_RANK[c.effort]||0)>(EFFORT_RANK[candidate.effort]||0)
    ));
    const escalation=(candidate.quality.escalationProbability??0)*(escalationCandidate?.predictedCost?.expected?.totalUsd||0);
    const verifier=verificationRequired?cheapest(candidates,c=>c.id!==candidate.id&&c.provider!==candidate.provider):null;
    const verification=verificationRequired?(verifier?.predictedCost?.expected?.totalUsd??null):0;
    candidate.expectedRetryCostUsd=round6(retry);
    candidate.expectedFallbackCostUsd=round6(fallback);
    candidate.expectedEscalationCostUsd=round6(escalation);
    candidate.expectedVerificationCostUsd=verification==null?null:round6(verification);
    if(verification==null){candidate.expectedTotalCostUsd=null;candidate.expectedCostPerSuccessfulTaskUsd=null;continue;}
    candidate.expectedTotalCostUsd=round6(base+retry+fallback+escalation+verification);
    candidate.expectedCostPerSuccessfulTaskUsd=candidate.quality.successProbability>0
      ?round6(candidate.expectedTotalCostUsd/candidate.quality.successProbability):null;
  }
}
function rankCandidates(candidates,profile){
  const empirical=candidates.filter(c=>c.expectedCostPerSuccessfulTaskUsd!=null);
  if(empirical.length){
    candidates.sort((a,b)=>{
      const ae=a.expectedCostPerSuccessfulTaskUsd,be=b.expectedCostPerSuccessfulTaskUsd;
      if(ae!=null&&be!=null)return ae-be;
      if(ae!=null)return-1;if(be!=null)return 1;
      return b.capabilityRank-a.capabilityRank;
    });
    return "expected-cost-per-successful-verified-task";
  }
  const priced=candidates.filter(c=>c.predictedCost?.expected?.totalUsd!=null);
  const minCost=priced.length?Math.min(...priced.map(c=>c.predictedCost.expected.totalUsd)):null;
  for(const c of candidates){
    const costNorm=minCost!=null&&c.predictedCost?.expected?.totalUsd!=null?Math.max(1,c.predictedCost.expected.totalUsd/Math.max(.000001,minCost)):3;
    const latencyNorm=LATENCY_RANK[c.latencyClass]||3;
    const capabilityReserve=Math.max(.6,1.35-(c.capabilityRank||1)*.14+(c.stability==="preview"?.3:0));
    c.selectionScore=round6(profile.costWeight*costNorm+profile.latencyWeight*latencyNorm+profile.reliabilityWeight*capabilityReserve);
  }
  candidates.sort((a,b)=>a.selectionScore-b.selectionScore||b.capabilityRank-a.capabilityRank);
  return "transparent-capability-cost-pareto";
}

export async function recommend(taskText,repoRoot=process.cwd(),context={}){
  const cfg=await loadArchitectConfig(repoRoot);
  const task=classifyTask(taskText,context);
  const complexity=estimateComplexity(taskText,task,context);
  const risk=estimateRisk(taskText,task,context);
  const route=mergedRoute(cfg.routing.default,cfg.routing.routes?.[task]||cfg.routing.routes?.generic||{});
  const tier=route.capability||"medium";
  const profileName=route.profile||cfg.project.execution?.defaultProfile||"balanced";
  const profile=EXECUTION_PROFILES[profileName]||EXECUTION_PROFILES.balanced;
  const reasoning=complexity>=4&&route.reasoning!=="max"?"high":(route.reasoning||"medium");
  const [prompt,workflow,projectProfile]=await Promise.all([
    loadPrompt(route.prompt,repoRoot),loadWorkflow(route.workflow,repoRoot),
    context.projectProfile?Promise.resolve(context.projectProfile):scanRepo(repoRoot)
  ]);
  const retrievalRequired=Boolean(route.retrieval?.required);
  const evidenceProvided=Array.isArray(context.retrievedEvidence)&&context.retrievedEvidence.length>0;
  const verificationRequired=Boolean(route.verification?.required||risk==="high");
  const budget=normalizeBudget({
    maxCostUsd:route.budgets?.maxCostUsd??cfg.project.execution?.defaultMaxCostUsd,
    maxInputTokens:route.budgets?.maxInputTokens??cfg.project.execution?.defaultMaxInputTokens,
    maxOutputTokens:route.budgets?.maxOutputTokens??cfg.project.execution?.defaultMaxOutputTokens,
    maxTotalTokens:route.budgets?.maxTotalTokens??cfg.project.execution?.defaultMaxTotalTokens,
    maxLatencyMs:route.budgets?.maxLatencyMs??cfg.project.execution?.defaultMaxLatencyMs,
    maxRetries:route.budgets?.maxRetries??cfg.project.execution?.defaultMaxRetries,
    maxFallbacks:route.budgets?.maxFallbacks??cfg.project.execution?.defaultMaxFallbacks,
    maxEscalations:route.budgets?.maxEscalations??cfg.project.execution?.defaultMaxEscalations,
    allowProviders:context.budget?.allowProviders,
    denyProviders:context.budget?.denyProviders,
    allowPreviewModels:context.budget?.allowPreviewModels,
    allowDynamicPricing:context.budget?.allowDynamicPricing??route.budgets?.allowDynamicPricing,
    allowUnknownPredictedCost:context.budget?.allowUnknownPredictedCost??route.budgets?.allowUnknownPredictedCost,
    minQuality:context.budget?.minQuality,
    requireEmpiricalQuality:context.budget?.requireEmpiricalQuality
  },profileName);

  const reservedOutput=Math.min(route.generation?.maxOutputTokens||4096,budget.maxOutputTokens||Infinity);
  const optimized=optimizeContext({
    prompt:taskText,
    context:context.context||"",
    contextSegments:buildSegments(context),
    maxContextTokens:budget.maxInputTokens||48000,
    reservedOutputTokens:reservedOutput
  });
  const inputTokens=roughInputTokens({prompt:taskText,context:optimized.text,instructions:prompt.text});
  const refs=[...(cfg.models.productionTiers?.[tier]||[])];
  const auto=cfg.models.autoRouter;
  if(auto?.enabled&&auto.allowedTiers?.includes(tier)&&budget.allowDynamicPricing)refs.push(auto.ref);
  const models=resolveModelRefs(refs);
  const calibration=context.calibrationStats||{};
  const accepted=[],rejected=[];

  for(const model of models){
    if((model.capabilityRank||0)<Math.max(CAPABILITY_FLOOR[tier]||1,profile.capabilityFloor||1)){
      rejected.push({id:model.id,reasons:["capability_floor_not_met"]});continue;
    }
    const effort=pickEffort(model,reasoning);
    const stats=calibration[calibrationKey(task,model,effort)]||null;
    const tokenBudget=predictTokenBudget({inputTokens,taskClass:task,complexity,model,effort,desiredOutputTokens:route.generation?.maxOutputTokens,calibration:stats});
    const maxProviderOutput=model.maxOutputTokens??model.applicationOutputCap??Infinity;
    if(inputTokens+tokenBudget.billedOutput.p95>model.contextWindow){rejected.push({id:model.id,reasons:["context_window_exceeded"]});continue;}
    if(tokenBudget.billedOutput.p95>maxProviderOutput){rejected.push({id:model.id,reasons:["model_output_limit_exceeded"]});continue;}
    const predictedCost=estimateCostEnvelope({model,inputTokens,tokenBudget,percentile:"p90",cacheTtl:context.cacheTtl||"5m"});
    const quality=estimateQuality({model,calibration:stats,minSamples:cfg.models.learning?.minVerifiedSamples||30});
    const candidate={...model,effort,inputTokens,tokenBudget,predictedCost,quality,calibration:stats};
    const reasons=checkCandidateBudget(candidate,budget);
    if(quality.source==="production-empirical"&&route.qualityGate!=null&&quality.successProbability<route.qualityGate)reasons.push("quality_gate_not_met");
    if(reasons.length){rejected.push({id:model.id,reasons});continue;}
    accepted.push(candidate);
  }
  enrichExpectedCosts(accepted,verificationRequired);
  const selectionMethod=rankCandidates(accepted,profile);

  return{
    schemaVersion:3,task,feature:context.feature||null,complexity,risk,
    project:cfg.project.project,projectProfile,profile:profileName,
    workflow,prompt,capabilityTier:tier,reasoning,tools:route.tools||[],
    retrieval:{required:retrievalRequired,evidenceProvided,strategy:route.retrieval?.strategy||null},
    verification:{required:verificationRequired,independent:route.verification?.independent??verificationRequired,strategy:route.verification?.strategy||"structural"},
    contextBudget:{maxTokens:budget.maxInputTokens,optimized:optimized.stats},
    optimizedContext:optimized.text,
    outputBudgetTokens:Math.min(route.generation?.maxOutputTokens||4096,budget.maxOutputTokens||Infinity),
    qualityGate:route.qualityGate||0,budget,budgets:budget,
    modelSelection:{
      strategy:cfg.models.strategy||"verified-cost-routing",
      method:selectionMethod,candidates:accepted,rejected,
      preferred:accepted[0]||null
    }
  };
}

export function explainPlan(plan){
  const reasons=[
    `Task '${plan.task}' uses ${plan.workflow.id}@${plan.workflow.version} with prompt ${plan.prompt.id}@${plan.prompt.version}.`,
    `Risk ${plan.risk}; complexity ${plan.complexity}/5; profile ${plan.profile}; capability tier ${plan.capabilityTier}; reasoning ${plan.reasoning}.`,
    `Context budget keeps ${plan.contextBudget.optimized.tokensAfter} estimated tokens from ${plan.contextBudget.optimized.tokensBefore}.`,
    `Routing method: ${plan.modelSelection.method}.`
  ];
  if(plan.retrieval.required)reasons.push(plan.retrieval.evidenceProvided?"Required retrieval evidence is present.":"Retrieval is mandatory and execution must block until evidence is supplied.");
  if(plan.verification.required)reasons.push("Independent actual-model verification is required before final success.");
  if(plan.modelSelection.preferred)reasons.push(`Preferred route: ${plan.modelSelection.preferred.provider}/${plan.modelSelection.preferred.model} at ${plan.modelSelection.preferred.effort} effort.`);
  else reasons.push("No candidate satisfies the current capability and budget policy.");
  if(plan.modelSelection.method!=="expected-cost-per-successful-verified-task")reasons.push("No empirical success probability is asserted yet; ranking uses transparent capability/cost policy.");
  return{summary:reasons.join(" "),reasons};
}
function round6(v){return Math.round(Number(v)*1e6)/1e6;}
