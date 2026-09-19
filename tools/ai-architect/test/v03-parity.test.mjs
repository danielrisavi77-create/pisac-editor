// Coverage parity with the deleted root AI Router V1/V2 suites
// (tests/ai-router*.test.mjs on main), re-expressed in v0.3 semantics.
// See docs/AI_ARCHITECT_V03_TEST_PARITY.md for what was judged obsolete.
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { AIArchitect } from "../src/architect.mjs";
import { recommend, explainPlan } from "../src/router.mjs";
import { getModel, MODEL_REGISTRY } from "../src/model-registry.mjs";
import { predictTokenBudget } from "../src/predictor.mjs";
import { optimizeContext, roughInputTokens } from "../src/context-budget.mjs";
import { estimateCostEnvelope, calculateActualCost } from "../src/pricing.mjs";
import { verifyContract } from "../src/contract-verifier.mjs";
import { computeMetrics } from "../src/metrics.mjs";
import {
  normalizeBudget,newBudgetLedger,noteAttemptKind,applyAttemptUsage,
  assertNextAttemptFits,checkCandidateBudget
} from "../src/budget.mjs";
import { OutcomeStore, NoopOutcomeStore } from "../src/outcome-store.mjs";
import { normalizeUsage } from "../src/providers/base.mjs";

const root=resolve(import.meta.dirname,"../../..");
function json(v,status=200){return new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json"}});}
class CaptureStore extends OutcomeStore{
  constructor(){super();this.bundles=[];}
  async writeBundle(bundle){this.bundles.push(bundle);return{stored:true,backend:"capture"};}
  async loadCalibration(){return{};}
  async readRecords(){return[];}
}
// Minimal OpenAI + Anthropic transport doubles: exact token count endpoints plus
// one generate endpoint each, so retry/fallback/escalation stay deterministic.
function transport({openai,anthropic,record=()=>{}}={}){
  return async (url,options)=>{
    const body=options?.body?JSON.parse(options.body):{};
    record({url,body});
    if(url.includes("responses/input_tokens"))return json({input_tokens:30});
    if(url.includes("count_tokens"))return json({input_tokens:30});
    if(url.includes("api.openai.com/v1/responses"))return openai(body);
    if(url.includes("api.anthropic.com"))return anthropic(body);
    throw new Error(`unexpected url ${url}`);
  };
}
function openaiText(body,text){
  return json({model:body.model,output:[{content:[{type:"output_text",text}]}],usage:{input_tokens:10,output_tokens:5,total_tokens:15}});
}
function anthropicText(body,text){
  return json({model:body.model,content:[{type:"text",text}],usage:{input_tokens:10,output_tokens:5}});
}

/* ---------- aggregate budget ledger across every attempt ---------- */

test("one aggregate ledger charges initial, retry, fallback, escalation and verifier calls",()=>{
  const ledger=newBudgetLedger(normalizeBudget({maxCostUsd:1,maxRetries:1,maxFallbacks:1,maxEscalations:1},"balanced"));
  for(const kind of ["initial","retry","fallback","escalation","verification"]){
    noteAttemptKind(ledger,kind);
    applyAttemptUsage(ledger,{usage:{inputTokens:100,outputTokens:50,totalTokens:150},costUsd:.05,latencyMs:10});
  }
  assert.equal(ledger.attempts,5);
  assert.equal(ledger.retries,1);assert.equal(ledger.fallbacks,1);assert.equal(ledger.escalations,1);
  assert.equal(Math.round(ledger.actual.costUsd*100)/100,.25);
  assert.equal(ledger.actual.totalTokens,750);
});

test("a strict aggregate budget refuses the next attempt before it is spent",()=>{
  const ledger=newBudgetLedger(normalizeBudget({maxCostUsd:.1},"balanced"));
  applyAttemptUsage(ledger,{usage:{inputTokens:10,outputTokens:10,totalTokens:20},costUsd:.09,latencyMs:1});
  assert.throws(
    ()=>assertNextAttemptFits({ledger,predictedCostUsd:.05,inputTokens:10,outputTokens:10}),
    error=>error.code==="AGGREGATE_COST_BUDGET_EXCEEDED"
  );
  assert.equal(ledger.attempts,0,"a refused attempt must not be charged to the ledger");
});

test("candidate budget contract reports why a route is refused instead of overspending",()=>{
  const model=getModel("openai:gpt-6-astra");
  const candidate={...model,inputTokens:5000,tokenBudget:{billedOutput:{p95:4000}},
    predictedCost:{budgetCeilingUsd:.5},quality:{source:"registry-capability-only",successProbability:null}};
  assert.ok(checkCandidateBudget(candidate,normalizeBudget({maxCostUsd:.0000001})).includes("max_cost_exceeded"));
  const dynamic={...candidate,dynamicPricing:true,predictedCost:{budgetCeilingUsd:null}};
  const reasons=checkCandidateBudget(dynamic,normalizeBudget({maxCostUsd:.05}));
  assert.ok(reasons.includes("predicted_cost_unknown"));
  assert.ok(reasons.includes("dynamic_pricing_denied"));
  assert.deepEqual(checkCandidateBudget(candidate,normalizeBudget({maxCostUsd:10})),[]);
});

test("numeric minQuality rejects unverifiable candidates rather than pretending the threshold is met",async()=>{
  const plan=await recommend("Jezično doradi ovaj tekst",root,{purpose:"language",budget:{minQuality:.9}});
  assert.equal(plan.modelSelection.preferred,null);
  assert.ok(plan.modelSelection.rejected.length>0);
  assert.ok(plan.modelSelection.rejected.every(r=>r.reasons.includes("min_quality_unverifiable")||r.reasons.includes("capability_floor_not_met")));
  assert.ok(plan.modelSelection.rejected.some(r=>r.reasons.includes("min_quality_unverifiable")));
  assert.match(explainPlan(plan).summary,/No candidate satisfies/);
});

/* ---------- retry vs fallback vs escalation stay separate ---------- */

test("escalation after a contract failure carries bounded corrective context",async()=>{
  const seen=[];
  const architect=new AIArchitect({repoRoot:root,env:{OPENAI_API_KEY:"x",ANTHROPIC_API_KEY:"y"},outcomeStore:new NoopOutcomeStore(),
    fetchImpl:transport({
      record:({url,body})=>{if(url.includes("/responses")||url.includes("messages"))seen.push(JSON.stringify(body));},
      openai:body=>openaiText(body,"nije json"),
      anthropic:body=>anthropicText(body,'{"name":"Ana"}')
    })});
  const result=await architect.execute("Jezično doradi rečenicu.",{
    purpose:"language",verification:{jsonSchema:{type:"object",required:["name"]}}
  });
  assert.equal(result.ok,true);
  assert.equal(result.provider,"anthropic");
  assert.equal(result.escalations,1);
  assert.equal(result.retries,0);
  assert.equal(result.fallbacks,0);
  const escalationBody=seen.at(-1);
  assert.match(escalationBody,/ORIGINAL TASK/);
  assert.match(escalationBody,/VERIFICATION FAILURES/);
  assert.match(escalationBody,/required_field_missing|invalid_json/);
  assert.equal(seen[0].includes("VERIFICATION FAILURES"),false,"the first attempt must not carry corrective context");
});

test("terminal provider failure preserves partial attempt telemetry",async()=>{
  const store=new CaptureStore();
  const architect=new AIArchitect({repoRoot:root,env:{OPENAI_API_KEY:"x"},outcomeStore:store,
    fetchImpl:transport({openai:()=>json({error:"broken"},400),anthropic:()=>json({error:"broken"},400)})});
  const result=await architect.execute("Jezično doradi rečenicu.",{purpose:"language"});
  assert.equal(result.ok,false);
  assert.ok(result.attempts.length>=1);
  assert.equal(result.attempts[0].success,false);
  assert.ok(result.attempts[0].errorType);
  assert.equal(result.attempts[0].attemptKind,"initial");
  const bundle=store.bundles.at(-1);
  assert.equal(bundle.final.finalVerifiedSuccess,false);
  assert.ok(bundle.final.failureClass);
  assert.equal(bundle.attempts.length,result.attempts.length);
});

test("metrics separate first-pass success, final verified success and retry/fallback/escalation",()=>{
  const finals=[
    {recordType:"final",firstPassSuccess:true,finalVerifiedSuccess:true,retryCount:0,fallbackCount:0,escalationCount:0,totalActualCostUsd:.1},
    {recordType:"final",firstPassSuccess:false,finalVerifiedSuccess:true,retryCount:1,fallbackCount:0,escalationCount:0,totalActualCostUsd:.2},
    {recordType:"final",firstPassSuccess:false,finalVerifiedSuccess:true,retryCount:0,fallbackCount:1,escalationCount:1,totalActualCostUsd:.3},
    {recordType:"final",firstPassSuccess:false,finalVerifiedSuccess:false,retryCount:0,fallbackCount:0,escalationCount:0,totalActualCostUsd:.4}
  ];
  const metrics=computeMetrics(finals);
  assert.equal(metrics.firstPassSuccessRate,.25);
  assert.equal(metrics.finalSuccessRate,.75);
  assert.equal(metrics.retryProbability,.25);
  assert.equal(metrics.fallbackProbability,.25);
  assert.equal(metrics.escalationProbability,.25);
  // Cost per success is total request spend over successful verified requests,
  // never an isolated attempt cost.
  assert.equal(Math.round(metrics.costPerSuccessfulVerifiedTaskUsd*1e6)/1e6,Math.round((1/3)*1e6)/1e6);
  assert.equal(metrics.successfulVerifiedTasks,3);
});

/* ---------- predicted / ceiling / actual / unknown cost stay distinct ---------- */

test("an executed request separates predicted cost from the aggregate actual cost",async()=>{
  const store=new CaptureStore();
  const architect=new AIArchitect({repoRoot:root,env:{OPENAI_API_KEY:"x"},outcomeStore:store,
    fetchImpl:transport({openai:body=>openaiText(body,"dorađena rečenica"),anthropic:body=>anthropicText(body,"x")})});
  const result=await architect.execute("Jezično doradi rečenicu.",{purpose:"language"});
  assert.equal(result.ok,true);
  assert.equal(result.costStatus,"aggregate-known");
  assert.ok(result.costUsd>0);
  const attempt=store.bundles.at(-1).attempts[0];
  assert.ok(attempt.predictedCostUsd>0);
  assert.ok(attempt.predictedBudgetCeilingUsd>=attempt.predictedCostUsd);
  assert.equal(attempt.actualCostStatus,"derived-actual-token-cost");
  assert.notEqual(attempt.actualCostUsd,null);
});

test("provider-reported billed cost outranks catalog derivation and dynamic pricing stays unknown",()=>{
  const grok=getModel("xai:grok-4.6");
  assert.equal(calculateActualCost(grok,{providerCostUsd:.123,inputTokens:9,outputTokens:9}).status,"verified-actual");
  assert.equal(calculateActualCost(grok,{inputTokens:1000,outputTokens:1000}).status,"derived-actual-token-cost");
  const auto=getModel("openrouter:openrouter/auto");
  const envelope=estimateCostEnvelope({model:auto,inputTokens:1000,tokenBudget:{billedOutput:{p90:500}}});
  assert.equal(envelope.expected.totalUsd,null);
  assert.equal(envelope.budgetCeilingUsd,null);
  assert.equal(calculateActualCost(auto,{inputTokens:1000,outputTokens:500}).status,"unknown");
});

test("a provider that reports no billed cost never yields a verified zero cost",()=>{
  const usage=normalizeUsage({inputTokens:100,outputTokens:50});
  assert.equal(usage.providerCostUsd,null,"absent provider cost must stay unknown, not 0");
  const derived=calculateActualCost(getModel("openai:gpt-5.6-luna"),usage);
  assert.equal(derived.status,"derived-actual-token-cost");
  assert.ok(derived.totalUsd>0);
  const reported=calculateActualCost(getModel("openai:gpt-5.6-luna"),normalizeUsage({inputTokens:100,outputTokens:50,providerCostUsd:.25}));
  assert.equal(reported.status,"verified-actual");
  assert.equal(reported.totalUsd,.25);
  assert.equal(calculateActualCost(getModel("openrouter:openrouter/auto"),usage).totalUsd,null);
});

/* ---------- token prediction ordering and the hard output cap ---------- */

test("token prediction keeps P50 <= P90 <= P95 for visible, reasoning and billed output",()=>{
  const model=getModel("openai:gpt-5.6-terra");
  const budget=predictTokenBudget({inputTokens:4000,taskClass:"research",complexity:4,model,effort:"high"});
  assert.ok(budget.visibleOutput.p50<=budget.visibleOutput.p90);
  assert.ok(budget.visibleOutput.p90<=budget.visibleOutput.p95);
  assert.ok(budget.reasoning.p50<=budget.reasoning.p90);
  assert.ok(budget.reasoning.p90<=budget.reasoning.p95);
  assert.ok(budget.billedOutput.p95>=budget.visibleOutput.p95);
  assert.equal(budget.billedOutput.p50,budget.visibleOutput.p50+budget.reasoning.p50);
});

test("the output token setting is a hard cap at every percentile across the routing matrix",()=>{
  const models=MODEL_REGISTRY.filter(m=>m.pricing?.outputIncludesReasoning!==undefined);
  const calibration={sampleCount:40,outputMedian:9000,outputP90:14000,outputP95:18000,
    reasoningMedian:7000,reasoningP90:11000,reasoningP95:15000};
  for(const model of models){
    for(const cap of [64,500,2500,9000]){
      for(const taskClass of ["grammar","research","generation"]){
        for(const effort of ["none","low","high","max"]){
          for(const calib of [null,calibration]){
            const p=predictTokenBudget({inputTokens:12000,taskClass,complexity:4,model,effort,desiredOutputTokens:cap,calibration:calib});
            const label=`${model.id} cap=${cap} ${taskClass}/${effort}/${calib?"empirical":"heuristic"}`;
            assert.ok(p.billedOutput.p95<=cap,`${label} p95=${p.billedOutput.p95}`);
            assert.ok(p.billedOutput.p90<=p.billedOutput.p95,`${label} p90>p95`);
            assert.ok(p.billedOutput.p50<=p.billedOutput.p90,`${label} p50>p90`);
            assert.ok(p.visibleOutput.p50<=p.visibleOutput.p90&&p.visibleOutput.p90<=p.visibleOutput.p95,`${label} visible not monotone`);
            assert.ok(p.reasoning.p50<=p.reasoning.p90&&p.reasoning.p90<=p.reasoning.p95,`${label} reasoning not monotone`);
            assert.equal(p.maxBilledOutputTokens,cap);
          }
        }
      }
    }
  }
});

test("empirical calibration bills visible output and reasoning exactly once",()=>{
  const model=getModel("openai:gpt-5.6-terra");
  const budget=predictTokenBudget({inputTokens:1000,taskClass:"generic",complexity:2,model,effort:"medium",
    calibration:{sampleCount:40,outputMedian:100,outputP90:180,outputP95:210,reasoningMedian:50,reasoningP90:90,reasoningP95:110}});
  assert.equal(budget.source,"production-empirical");
  assert.equal(budget.visibleOutput.p50,100);
  assert.equal(budget.reasoning.p50,50);
  assert.equal(budget.billedOutput.p50,150);
  assert.equal(budget.billedOutput.p90,270);
  assert.equal(budget.billedOutput.p95,320);
});

test("a model without a reasoning mode never receives a phantom reasoning budget",()=>{
  const mock=getModel("local:local/mock");
  assert.deepEqual(mock.reasoningModes,["none"]);
  const budget=predictTokenBudget({inputTokens:1000,taskClass:"generic",complexity:2,model:mock,effort:"none"});
  assert.equal(budget.reasoning.p50,0);
  assert.equal(budget.reasoning.p90,0);
  assert.equal(budget.reasoning.p95,0);
  assert.equal(budget.billedOutput.p90,budget.visibleOutput.p90);
  const lite=getModel("gemini:gemini-3.5-flash-lite");
  assert.ok(lite.reasoningModes.includes("minimal"));
  const minimal=predictTokenBudget({inputTokens:1000,taskClass:"generic",complexity:2,model:lite,effort:"minimal"});
  assert.ok(minimal.reasoning.p50>0&&minimal.reasoning.p50<100);
});

/* ---------- exact vs heuristic token counting is labelled, never assumed ---------- */

test("an exact provider token count is labelled provider-exact in attempt telemetry",async()=>{
  const store=new CaptureStore();
  const architect=new AIArchitect({repoRoot:root,env:{OPENAI_API_KEY:"x"},outcomeStore:store,
    fetchImpl:transport({openai:body=>openaiText(body,"dorađena rečenica"),anthropic:body=>anthropicText(body,"x")})});
  const result=await architect.execute("Jezično doradi rečenicu.",{purpose:"language"});
  assert.equal(result.ok,true);
  const attempt=store.bundles.at(-1).attempts[0];
  assert.equal(attempt.inputTokenMethod,"provider-exact");
  assert.equal(attempt.predictedInputTokens,30);
});

test("a route without an exact counting endpoint stays explicitly heuristic",async()=>{
  const store=new CaptureStore();
  const architect=new AIArchitect({repoRoot:root,env:{OPENROUTER_API_KEY:"x"},outcomeStore:store,
    fetchImpl:async(_url,options)=>{
      const body=JSON.parse(options.body);
      return json({model:body.model,choices:[{message:{content:"ok"}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15,cost:.001}});
    }});
  const result=await architect.execute("Jezično doradi rečenicu.",{
    purpose:"language",budget:{allowDynamicPricing:true,allowUnknownPredictedCost:true}
  });
  assert.equal(result.ok,true);
  const attempt=store.bundles.at(-1).attempts[0];
  assert.equal(attempt.inputTokenMethod,"heuristic");
  assert.ok(roughInputTokens({prompt:"Kratak tekst"})>0);
});

/* ---------- context budgeting fails closed for mandatory segments ---------- */

test("reserved output tokens count against the context budget and fail closed",()=>{
  const segments=[{text:"TypeError: x is undefined",type:"error"}];
  const fits=optimizeContext({prompt:"Popravi test",contextSegments:segments,maxContextTokens:400,reservedOutputTokens:50});
  assert.match(fits.text,/TypeError/);
  assert.equal(fits.stats.reservedOutputTokens,50);
  assert.throws(
    ()=>optimizeContext({prompt:"Popravi test",contextSegments:segments,maxContextTokens:60,reservedOutputTokens:58}),
    error=>error.code==="CRITICAL_CONTEXT_BUDGET_EXCEEDED"&&error.availableTokens<error.mandatoryTokens
  );
});

test("optional context is dropped before mandatory error and security evidence",()=>{
  const result=optimizeContext({
    prompt:"Popravi test",
    contextSegments:[
      {text:"nebitan sadržaj ".repeat(100),type:"user"},
      {text:"nebitan sadržaj ".repeat(100),type:"user"},
      {text:"TypeError: x is undefined",type:"error"},
      {text:"Do not leak the service role key.",type:"security"}
    ],
    maxContextTokens:60
  });
  assert.equal(result.stats.duplicateSegmentsRemoved,1);
  assert.match(result.text,/TypeError/);
  assert.match(result.text,/service role key/);
  assert.equal(result.text.includes("nebitan sadržaj"),false);
  assert.equal(result.stats.truncated,true);
  assert.ok(result.stats.tokensAfter<=result.stats.tokensBefore);
});

/* ---------- verification: deterministic gate vs independent actual model ---------- */

test("deterministic contract verification reports codes and never a probability",()=>{
  const schema={type:"object",required:["name"],properties:{name:{type:"string"}}};
  const failed=verifyContract({text:'{"age":2}',verification:{jsonSchema:schema}});
  assert.equal(failed.passed,false);
  assert.ok(failed.failures.some(x=>x.code==="required_field_missing"));
  assert.equal("score" in failed,false);
  assert.equal("successProbability" in failed,false);
  assert.equal(verifyContract({text:"not json",verification:{jsonSchema:schema}}).failures.some(x=>x.code==="invalid_json"),true);
  assert.equal(verifyContract({text:'{"name":"Ana"}',verification:{jsonSchema:schema}}).passed,true);
});

test("a verifier resolving to the same actual model is not independent verification",async()=>{
  const store=new CaptureStore();
  const architect=new AIArchitect({repoRoot:root,env:{OPENAI_API_KEY:"x"},outcomeStore:store,
    fetchImpl:transport({
      // Every requested OpenAI route resolves to one and the same actual model.
      openai:()=>json({model:"gpt-5.6-sol",output:[{content:[{type:"output_text",text:"VERDICT: PASS"}]}],usage:{input_tokens:10,output_tokens:5,total_tokens:15}}),
      anthropic:body=>anthropicText(body,"VERDICT: PASS")
    })});
  const result=await architect.execute("Provjeri ovaj citat i DOI.",{
    retrievedEvidence:[{title:"Evidence",source:"test",excerpt:"Support"}]
  });
  assert.equal(result.ok,false);
  assert.equal(result.code,"VERIFICATION_UNAVAILABLE");
  const verifications=store.bundles.at(-1).verifications;
  assert.ok(verifications.length>0);
  assert.ok(verifications.every(v=>v.sameActualModel===true&&v.passed===false));
});

test("independent verifier spend is charged to the same request ledger",async()=>{
  const store=new CaptureStore();
  const calls=[];
  const architect=new AIArchitect({repoRoot:root,env:{OPENAI_API_KEY:"x"},outcomeStore:store,
    fetchImpl:transport({
      record:({url})=>{if(url.includes("/responses")&&!url.includes("input_tokens"))calls.push(url);},
      openai:body=>openaiText(body,body.input?.includes?.("independent verifier")?"VERDICT: PASS":"Provjereni odgovor."),
      anthropic:body=>anthropicText(body,"VERDICT: PASS")
    })});
  const result=await architect.execute("Provjeri ovaj citat i DOI.",{
    retrievedEvidence:[{title:"Evidence",source:"test",excerpt:"Support"}]
  });
  assert.equal(result.ok,true);
  assert.equal(result.verification.status,"passed");
  assert.equal(calls.length,2,"primary attempt plus one independent verification");
  assert.equal(result.usage.inputTokens,20);
  assert.equal(result.usage.outputTokens,10);
  const bundle=store.bundles.at(-1);
  assert.equal(bundle.attempts.length,1);
  assert.equal(bundle.verifications.length,1);
  assert.ok(bundle.final.totalActualCostUsd>bundle.attempts[0].actualCostUsd);
});
