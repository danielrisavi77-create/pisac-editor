import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getModel, validateModelRegistry } from "../src/model-registry.mjs";
import { optimizeContext } from "../src/context-budget.mjs";
import { predictTokenBudget } from "../src/predictor.mjs";
import { estimateCostEnvelope, calculateActualCost } from "../src/pricing.mjs";
import { normalizeBudget, newBudgetLedger, noteAttemptKind, applyAttemptUsage, assertNextAttemptFits, assertLedgerWithinBudget } from "../src/budget.mjs";
import { toDbRequest, toDbAttempt, toDbVerification, toDbFinal, LocalOutcomeStore } from "../src/outcome-store.mjs";
import { computeMetrics } from "../src/metrics.mjs";
import { UsagePolicy, productionUsageReadiness } from "../src/usage-policy.mjs";
import { verifyContract } from "../src/contract-verifier.mjs";
import { estimateQuality } from "../src/quality.mjs";

const root=resolve(import.meta.dirname,"../../..");

test("canonical registry validates and contains corrected official model metadata",()=>{
  const result=validateModelRegistry();assert.equal(result.valid,true,JSON.stringify(result.errors));
  assert.ok(result.count>=14);
  const opus=getModel("anthropic:claude-opus-5");assert.equal(opus.pricing.inputUsdPerM,5);assert.equal(opus.pricing.outputUsdPerM,25);
  const sonnet=getModel("anthropic:claude-sonnet-5");assert.equal(sonnet.pricing.inputUsdPerM,2);assert.equal(sonnet.pricing.outputUsdPerM,10);
  const grok=getModel("xai:grok-4.6");assert.equal(grok.maxOutputTokens,null);assert.equal(grok.contextWindow,500000);
  assert.equal(getModel("openrouter:openrouter/auto").dynamicPricing,true);
});

test("context optimizer deduplicates but never silently drops mandatory evidence",()=>{
  const evidence="Verified source evidence ".repeat(20);
  const result=optimizeContext({
    prompt:"Provjeri citat",maxContextTokens:400,reservedOutputTokens:50,
    contextSegments:[
      {text:evidence,type:"evidence",pinned:true},
      {text:"optional unrelated paragraph ".repeat(100),type:"note"},
      {text:evidence,type:"evidence",pinned:true}
    ]
  });
  assert.equal(result.stats.duplicateSegmentsRemoved,1);assert.ok(result.text.includes("Verified source evidence"));
  assert.equal(result.stats.mandatorySegments,1);
});

test("critical evidence overflow fails closed",()=>{
  assert.throws(()=>optimizeContext({
    prompt:"x",maxContextTokens:10,reservedOutputTokens:0,
    contextSegments:[{text:"evidence ".repeat(200),type:"evidence",pinned:true}]
  }),error=>error.code==="CRITICAL_CONTEXT_BUDGET_EXCEEDED");
});

test("token prediction is heuristic before calibration and empirical after enough samples",()=>{
  const model=getModel("openai:gpt-5.6-sol");
  let p=predictTokenBudget({inputTokens:1000,taskClass:"research",complexity:4,model,effort:"high"});
  assert.equal(p.source,"heuristic");assert.ok(p.visibleOutput.p95>=p.visibleOutput.p90);
  p=predictTokenBudget({inputTokens:1000,taskClass:"research",complexity:4,model,effort:"high",calibration:{
    sampleCount:25,outputMedian:500,outputP90:900,outputP95:1100,reasoningMedian:200,reasoningP90:450,reasoningP95:600
  }});
  assert.equal(p.source,"production-empirical");assert.equal(p.visibleOutput.p90,900);assert.equal(p.reasoning.p95,600);
});

test("quality probability is not invented before verified production samples",()=>{
  const model=getModel("openai:gpt-5.6-sol");
  assert.equal(estimateQuality({model,calibration:{verifiedSampleCount:29,finalSuccessRate:.99},minSamples:30}).successProbability,null);
  const q=estimateQuality({model,calibration:{verifiedSampleCount:30,finalSuccessRate:.8,firstPassSuccessRate:.6,retryRate:.2,fallbackRate:.1,escalationRate:.1},minSamples:30});
  assert.equal(q.source,"production-empirical");assert.equal(q.successProbability,.8);
});

test("pricing distinguishes prediction actual provider-reported and unknown",()=>{
  const sol=getModel("openai:gpt-5.6-sol");
  const predicted=estimateCostEnvelope({model:sol,inputTokens:1000,tokenBudget:{billedOutput:{p90:500}},percentile:"p90"});
  assert.equal(predicted.expected.status,"predicted");assert.ok(predicted.expected.totalUsd>0);
  const actual=calculateActualCost(sol,{inputTokens:1000,cachedInputTokens:500,cacheWriteTokens:0,outputTokens:500});
  assert.equal(actual.status,"derived-actual-token-cost");assert.ok(actual.totalUsd>0);
  const billed=calculateActualCost(getModel("xai:grok-4.6"),{providerCostUsd:.123,inputTokens:1,outputTokens:1});
  assert.equal(billed.status,"verified-actual");assert.equal(billed.totalUsd,.123);
  assert.equal(estimateCostEnvelope({model:getModel("openrouter:openrouter/auto"),inputTokens:1000,tokenBudget:{billedOutput:{p90:500}}}).expected.totalUsd,null);
});

test("long-context pricing uses documented rate rule",()=>{
  const astra=getModel("openai:gpt-6-astra");
  const short=estimateCostEnvelope({model:astra,inputTokens:100000,tokenBudget:{billedOutput:{p90:1000}}}).expected;
  const long=estimateCostEnvelope({model:astra,inputTokens:300000,tokenBudget:{billedOutput:{p90:1000}}}).expected;
  assert.ok(long.rates.inLongContext);assert.ok(long.rates.inputUsdPerM>short.rates.inputUsdPerM);
});

test("aggregate budget counts retry/fallback/escalation and fails on actual overruns",()=>{
  const budget=normalizeBudget({maxCostUsd:.02,maxTotalTokens:100,maxLatencyMs:10000,maxRetries:1,maxFallbacks:1,maxEscalations:1},"balanced");
  const ledger=newBudgetLedger(budget,Date.now());
  assertNextAttemptFits({ledger,predictedCostUsd:.01,inputTokens:20,outputTokens:20});
  noteAttemptKind(ledger,"initial");applyAttemptUsage(ledger,{usage:{inputTokens:20,outputTokens:20,totalTokens:40},costUsd:.01,latencyMs:10});
  noteAttemptKind(ledger,"retry");assert.equal(ledger.retries,1);
  applyAttemptUsage(ledger,{usage:{inputTokens:20,outputTokens:20,totalTokens:40},costUsd:.015,latencyMs:10});
  assert.throws(()=>assertLedgerWithinBudget(ledger),error=>error.code==="AGGREGATE_COST_BUDGET_EXCEEDED");
});

test("unknown actual cost is never treated as zero under a hard cost budget",()=>{
  const ledger=newBudgetLedger(normalizeBudget({maxCostUsd:1},"balanced"));
  applyAttemptUsage(ledger,{usage:{inputTokens:1,outputTokens:1},costUsd:null});
  assert.equal(ledger.unknownCost,true);assert.throws(()=>assertLedgerWithinBudget(ledger),e=>e.code==="ACTUAL_COST_UNKNOWN");
});

test("Supabase telemetry mapping matches snake_case schema and omits undefined",()=>{
  assert.deepEqual(toDbRequest({requestId:"id",taskClass:"grammar",promptFingerprint:"x".repeat(64)}),{request_id:"id",task_class:"grammar",prompt_fingerprint:"x".repeat(64)});
  assert.equal(toDbAttempt({requestId:"id",attemptNumber:1,attemptKind:"initial",requestedModel:"m"}).requested_model,"m");
  assert.equal(toDbVerification({verificationId:"v",requestId:"id",sameActualModel:false}).same_actual_model,false);
  assert.equal(toDbFinal({requestId:"id",taskClass:"grammar",finalVerifiedSuccess:true}).final_verified_success,true);
});

test("metrics expose reliability threshold instead of overstating tiny samples",()=>{
  const records=[
    {recordType:"final",finalVerifiedSuccess:true,firstPassSuccess:true,totalActualCostUsd:.1,totalLatencyMs:100,provider:"openai"},
    {recordType:"attempt",predictedOutputP90:100,actualOutputTokens:90,taskClass:"grammar",provider:"openai",requestedModel:"m",reasoningLevel:"low",success:true,actualCostUsd:.1,latencyMs:100}
  ];
  const metrics=computeMetrics(records);assert.equal(metrics.reliable,false);assert.equal(metrics.requests,1);assert.equal(metrics.successfulVerifiedTasks,1);
});

test("UsagePolicy and production readiness require identity quota and distributed limiter",()=>{
  const policy=new UsagePolicy({requireIdentity:true,tiers:{free:{maxDailyRequests:10}}});
  assert.equal(policy.evaluate({userId:null,tier:"free",dailyRequests:0}).allowed,false);
  assert.equal(policy.evaluate({userId:"u",tier:"free",dailyRequests:10}).allowed,false);
  assert.deepEqual(productionUsageReadiness({hasIdentity:true,hasPerUserQuota:true,hasDistributedRateLimit:false}),{ready:false,missing:["distributed_rate_limit"]});
});

test("contract verifier is a gate, not a fake probability",()=>{
  const result=verifyContract({text:'{"ok":true}',verification:{jsonSchema:{type:"object",required:["ok"]}}});
  assert.equal(result.passed,true);assert.equal("score" in result,false);
});

test("v0.3 Supabase migration is RLS/service-role locked and security-invoker",async()=>{
  const sql=await readFile(resolve(root,"supabase/migrations/2026091903_ai_architect_v03.sql"),"utf8");
  for(const table of ["ai_architect_requests","ai_architect_attempts","ai_architect_verifications","ai_architect_results"]){
    assert.ok(sql.includes(`alter table public.${table} enable row level security`));
    assert.ok(sql.includes(`revoke all on public.${table} from anon, authenticated`));
  }
  assert.ok(sql.includes("with (security_invoker=true)"));
  assert.ok(sql.includes("grant select on public.ai_architect_calibration_stats to service_role"));
});

test("production planning never prefers the test-only local mock", async () => {
  const { recommend } = await import("../src/router.mjs");
  const plan = await recommend("Jezično doradi ovaj tekst", root);
  assert.equal(plan.modelSelection.candidates.some(c => c.id === "local:local/mock"), false);
  assert.notEqual(plan.modelSelection.preferred?.id, "local:local/mock");
});

test("output prediction hard cap is respected at P95", () => {
  const model=getModel("openai:gpt-5.6-luna");
  const prediction=predictTokenBudget({
    inputTokens:12000,taskClass:"grammar",complexity:2,model,effort:"low",desiredOutputTokens:2500
  });
  assert.ok(prediction.billedOutput.p95 <= 2500);
  assert.ok(prediction.billedOutput.p90 <= prediction.billedOutput.p95);
  assert.ok(prediction.billedOutput.p50 <= prediction.billedOutput.p90);
});
