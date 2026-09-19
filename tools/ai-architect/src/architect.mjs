import { loadArchitectConfig } from "./config.mjs";
import { recommend, explainPlan } from "./router.mjs";
import { classifyTask } from "./classify.mjs";
import { createProviderRegistry } from "./providers/registry.mjs";
import { validateOutput, parseVerifierVerdict } from "./validate-output.mjs";
import { verifyContract } from "./contract-verifier.mjs";
import {
  newBudgetLedger,assertNextAttemptFits,applyAttemptUsage,noteAttemptKind,canUseAttemptKind,remainingBudget
} from "./budget.mjs";
import { predictTokenBudget } from "./predictor.mjs";
import { estimateCostEnvelope, calculateActualCost } from "./pricing.mjs";
import { getModel } from "./model-registry.mjs";
import { createOutcomeStore } from "./outcome-store.mjs";
import { computeMetrics, groupTaskModelStats } from "./metrics.mjs";
import { newExecutionTrace,addAttempt,addVerification,finishTrace,bundleTrace } from "./execution-telemetry.mjs";
import { recordOutcome as legacyRecordOutcome } from "./outcomes.mjs";

const EFFORT_RANK={"provider-default":1,none:0,minimal:.5,low:1,medium:2,high:3,xhigh:4,max:5};

function systemPrompt(plan){
  const parts=[
    plan.prompt.text,
    `Workflow: ${plan.workflow.steps.join(" -> ")}.`,
    `Reasoning policy: ${plan.reasoning}.`
  ];
  if(plan.retrieval.required)parts.push("Use supplied retrieved evidence as the factual basis. If evidence is insufficient, leave the claim unresolved rather than guessing.");
  if(plan.verification.required)parts.push("This task must pass verification before it can be treated as successful.");
  return parts.join("\n\n");
}
function userPrompt(taskText,optimizedContext=""){
  return optimizedContext?`TASK:\n${taskText}\n\nCONTEXT:\n${optimizedContext}`:`TASK:\n${taskText}`;
}
function candidateKey(c){return c?`${c.provider}|${c.model}|${c.effort}`:"";}
function canonicalModelId(value=""){
  return String(value).trim().toLowerCase().replace(/^(openai|anthropic|google|gemini|deepseek|xai|x-ai|meta-llama|mistralai)\//,"");
}
function buildEscalationTask(originalTask,previousText,failures=[]){
  const list=failures.map(x=>`- ${x.code||"verification_failure"}: ${x.message||x.reason||"Failed verification"}`).join("\n");
  return[
    "ORIGINAL TASK",originalTask,"",
    "PREVIOUS ATTEMPT",String(previousText||"").slice(0,12000),"",
    "VERIFICATION FAILURES",list||"- The previous result did not pass verification.","",
    "CORRECTION INSTRUCTION",
    "Produce a corrected answer to the original task that fixes every listed failure. Do not discuss the retry/escalation process."
  ].join("\n");
}
function failureResult(plan,code,message,attempts=[],extra={}){
  return{ok:false,status:"failed",code,message,plan,attempts,...extra};
}
function providerTransient(error){
  if(error?.transient===true)return true;
  const status=Number(error?.status)||null;
  return error?.name==="AbortError"||status===408||status===425||status===429||(status!=null&&status>=500);
}
function failureCode(error){
  if(error?.code)return String(error.code);
  if(error?.name==="AbortError")return"PROVIDER_TIMEOUT";
  if(Number(error?.status)===429)return"PROVIDER_RATE_LIMITED";
  return"PROVIDER_ERROR";
}

export class AIArchitect{
  constructor({
    repoRoot=process.cwd(),env=process.env,fetchImpl=globalThis.fetch,
    outcomeStore=null,outcomeSink=null,statsSource=null,allowMock=false
  }={}){
    this.repoRoot=repoRoot;this.env=env;this.fetchImpl=fetchImpl;
    this.outcomeStore=outcomeStore||createOutcomeStore(env,{repoRoot,fetchImpl});
    this.outcomeSink=outcomeSink; // v0.2 compatibility hook
    this.statsSource=statsSource; // v0.2 compatibility hook
    this.allowMock=allowMock;this._config=null;
  }

  async config(){
    if(!this._config)this._config=await loadArchitectConfig(this.repoRoot);
    return this._config;
  }

  async plan(taskText,context={}){
    let calibrationStats=context.calibrationStats;
    if(!calibrationStats){
      const taskClass=classifyTask(taskText,context);
      calibrationStats=await this.outcomeStore.loadCalibration({taskClass});
    }
    if(this.statsSource&&!context.calibrationStats){
      const legacy=await this.statsSource();
      if(legacy&&typeof legacy==="object"&&!Array.isArray(legacy))calibrationStats={...calibrationStats,...legacy};
    }
    return recommend(taskText,this.repoRoot,{...context,calibrationStats});
  }

  async explain(taskText,context={}){
    const plan=await this.plan(taskText,context);
    return{plan,rationale:explainPlan(plan)};
  }

  async evaluate({output,taskClass="generic",verification={},externalChecks={}}={}){
    return verifyContract({text:output,taskClass,verification,externalChecks});
  }

  async execute(taskText,context={}){
    const plan=await this.plan(taskText,context);
    const trace=newExecutionTrace(plan,taskText);
    const ledger=newBudgetLedger(plan.budget);
    const cfg=await this.config();

    if(plan.retrieval.required&&!plan.retrieval.evidenceProvided){
      return this.#finishFailure({
        plan,trace,ledger,taskText,context,code:"RETRIEVAL_REQUIRED",
        message:"Retrieved evidence is required before execution. The task was blocked rather than allowing a model to guess."
      });
    }

    const providers=createProviderRegistry(cfg.models,{env:this.env,fetchImpl:this.fetchImpl,allowMock:this.allowMock});
    const candidates=providers.availableCandidates(plan.modelSelection.candidates||[],context);
    if(!candidates.length){
      if(context.allowDegraded&&context.degradedOutput){
        await this.#persistFinal({
          plan,trace,ledger,taskText,context,outputText:null,success:false,failureClass:"NO_PROVIDER_AVAILABLE"
        });
        return{ok:false,status:"degraded",code:"NO_PROVIDER_AVAILABLE",message:"No live provider is available. Returning explicitly allowed degraded output.",plan,output:String(context.degradedOutput),attempts:trace.attempts};
      }
      return this.#finishFailure({
        plan,trace,ledger,taskText,context,code:"NO_PROVIDER_AVAILABLE",
        message:"No configured provider is available for the selected route."
      });
    }

    let current=candidates[0];
    let executionTask=taskText;
    let nextKind="initial";
    let firstPassSuccess=false;
    const used=new Set();
    let finalFailure="EXECUTION_EXHAUSTED";
    let lastOutput="";
    let lastFailures=[];

    while(current){
      const provider=providers.get(current.provider);
      if(!provider){used.add(candidateKey(current));current=this.#pickFallback(current,candidates,used,ledger,providers,context);nextKind="fallback";continue;}
      let operationalFailure=null;
      let qualityFailure=null;
      let localTry=0;

      while(true){
        const attemptKind=localTry>0?"retry":nextKind;
        if(attemptKind==="retry"&&!canUseAttemptKind(ledger,"retry"))break;

        let prepared;
        try{
          prepared=await this.#prepareCandidate({candidate:current,provider,taskText:executionTask,plan});
          assertNextAttemptFits({
            ledger,candidate:prepared,predictedCostUsd:prepared.predictedCost.budgetCeilingUsd,
            inputTokens:prepared.inputTokens,outputTokens:prepared.tokenBudget.billedOutput.p95
          });
        }catch(error){
          finalFailure=error?.code||"PREFLIGHT_FAILED";
          operationalFailure=error;
          break;
        }

        noteAttemptKind(ledger,attemptKind);
        const started=Date.now();
        try{
          const response=await provider.execute({
            model:prepared.model,
            system:systemPrompt(plan),
            user:userPrompt(executionTask,plan.optimizedContext),
            plan:{...plan,reasoning:prepared.effort,outputBudgetTokens:Math.min(plan.outputBudgetTokens,prepared.maxOutputTokens??prepared.applicationOutputCap??plan.outputBudgetTokens)}
          });
          const latencyMs=response.latencyMs??(Date.now()-started);
          const catalogModel=getModel(prepared.id);
          const actualCost=response.costUsd!=null
            ?{status:response.costStatus||"verified-actual",totalUsd:Number(response.costUsd),source:"provider-reported"}
            :calculateActualCost(catalogModel,response.usage,{cacheTtl:context.cacheTtl||"5m"});
          applyAttemptUsage(ledger,{usage:response.usage,costUsd:actualCost.totalUsd,latencyMs});

          const structural=validateOutput(response.output,plan);
          const contract=verifyContract({
            text:response.output,taskClass:plan.task,
            verification:context.verification||{},externalChecks:context.externalChecks||{}
          });
          const attemptRecord=addAttempt(trace,{
            attemptKind,taskClass:plan.task,provider:prepared.provider,requestedModel:prepared.model,
            actualModel:response.actualModel,reasoningLevel:prepared.effort,inputTokenMethod:prepared.inputTokenMethod,
            predictedInputTokens:prepared.inputTokens,actualInputTokens:response.usage?.inputTokens,
            predictedOutputP50:prepared.tokenBudget.visibleOutput.p50,predictedOutputP90:prepared.tokenBudget.visibleOutput.p90,
            predictedOutputP95:prepared.tokenBudget.visibleOutput.p95,predictedReasoningP90:prepared.tokenBudget.reasoning.p90,
            actualOutputTokens:response.usage?.outputTokens,actualVisibleOutputTokens:response.usage?.visibleOutputTokens,
            actualReasoningTokens:response.usage?.reasoningTokens,cacheReadTokens:response.usage?.cachedInputTokens,
            cacheWriteTokens:response.usage?.cacheWriteTokens,predictedCostUsd:prepared.predictedCost.expected.totalUsd,
            predictedBudgetCeilingUsd:prepared.predictedCost.budgetCeilingUsd,actualCostUsd:actualCost.totalUsd,
            actualCostStatus:actualCost.status,latencyMs,contractPassed:structural.passed&&contract.passed,success:false
          });
          lastOutput=response.output;

          if(!structural.passed||!contract.passed){
            const structuralFailures=structural.checks.filter(x=>!x.passed).map(x=>({code:x.id,message:x.reason}));
            lastFailures=[...structuralFailures,...contract.failures];
            qualityFailure={code:"CONTRACT_VERIFICATION_FAILED",failures:lastFailures};
            finalFailure=qualityFailure.code;
            break;
          }

          let independent={passed:true,status:"not-required",failures:[]};
          if(plan.verification.required&&plan.verification.independent){
            independent=await this.#verifyIndependent({
              taskText:executionTask,answer:response.output,primary:response,primaryCandidate:prepared,
              candidates,providers,plan,context,ledger,trace,parentAttemptNumber:attemptRecord.attemptNumber
            });
          }

          if(!independent.passed){
            lastFailures=independent.failures||[{code:independent.status,message:independent.reason||"Independent verification failed."}];
            qualityFailure={code:independent.status==="unavailable"?"VERIFICATION_UNAVAILABLE":"VERIFICATION_FAILED",failures:lastFailures};
            finalFailure=qualityFailure.code;
            break;
          }

          attemptRecord.success=true;
          if(trace.attempts.length===1&&attemptKind==="initial")firstPassSuccess=true;
          const result={
            ok:true,status:"success",plan,provider:response.provider,requestedModel:response.requestedModel,
            actualModel:response.actualModel,output:response.output,usage:{...ledger.actual},
            costUsd:ledger.unknownCost?null:ledger.actual.costUsd,costStatus:ledger.unknownCost?"unknown":"aggregate-known",
            latencyMs:Date.now()-ledger.startedAt,verification:independent,
            retries:ledger.retries,fallbacks:ledger.fallbacks,escalations:ledger.escalations,
            budgetRemaining:remainingBudget(ledger)
          };
          await this.#persistFinal({
            plan,trace,ledger,taskText,context,outputText:response.output,success:true,firstPassSuccess,
            provider:response.provider,requestedModel:response.requestedModel,actualModel:response.actualModel
          });
          return result;
        }catch(error){
          const code=failureCode(error);
          addAttempt(trace,{
            attemptKind,taskClass:plan.task,provider:prepared.provider,requestedModel:prepared.model,
            actualModel:null,reasoningLevel:prepared.effort,inputTokenMethod:prepared.inputTokenMethod,
            predictedInputTokens:prepared.inputTokens,predictedOutputP50:prepared.tokenBudget.visibleOutput.p50,
            predictedOutputP90:prepared.tokenBudget.visibleOutput.p90,predictedOutputP95:prepared.tokenBudget.visibleOutput.p95,
            predictedCostUsd:prepared.predictedCost.expected.totalUsd,predictedBudgetCeilingUsd:prepared.predictedCost.budgetCeilingUsd,
            latencyMs:Date.now()-started,contractPassed:null,success:false,errorType:code,transientError:providerTransient(error)
          });
          finalFailure=code;
          if(providerTransient(error)&&canUseAttemptKind(ledger,"retry")){localTry+=1;continue;}
          operationalFailure=error;break;
        }
      }

      used.add(candidateKey(current));

      if(operationalFailure){
        const fallback=this.#pickFallback(current,candidates,used,ledger,providers,context);
        if(fallback){current=fallback;nextKind="fallback";continue;}
        break;
      }
      if(qualityFailure){
        const escalation=this.#pickEscalation(current,candidates,used,ledger,providers,context);
        if(escalation){
          executionTask=buildEscalationTask(taskText,lastOutput,qualityFailure.failures);
          current=escalation;nextKind="escalation";continue;
        }
        break;
      }
      break;
    }

    if(context.allowDegraded&&context.degradedOutput){
      await this.#persistFinal({plan,trace,ledger,taskText,context,outputText:null,success:false,firstPassSuccess,failureClass:finalFailure});
      return{ok:false,status:"degraded",code:finalFailure,message:"Live execution did not pass all required gates. A clearly labelled degraded response is available.",plan,output:String(context.degradedOutput),attempts:trace.attempts};
    }
    return this.#finishFailure({plan,trace,ledger,taskText,context,code:finalFailure,message:"No execution route passed all required gates.",firstPassSuccess});
  }

  async #prepareCandidate({candidate,provider,taskText,plan}){
    let inputTokens=candidate.inputTokens,inputTokenMethod="heuristic";
    if(provider?.supportsExactTokenCount&&typeof provider.countTokens==="function"){
      try{
        const counted=await provider.countTokens({
          model:candidate.model,system:systemPrompt(plan),user:userPrompt(taskText,plan.optimizedContext),
          plan:{...plan,reasoning:candidate.effort}
        });
        if(Number.isFinite(Number(counted.inputTokens))){inputTokens=Number(counted.inputTokens);inputTokenMethod=counted.method||"provider-exact";}
      }catch{inputTokenMethod="heuristic-fallback";}
    }
    const tokenBudget=predictTokenBudget({
      inputTokens,taskClass:plan.task,complexity:plan.complexity,model:candidate,effort:candidate.effort,
      desiredOutputTokens:plan.outputBudgetTokens,calibration:candidate.calibration
    });
    const predictedCost=estimateCostEnvelope({model:candidate,inputTokens,tokenBudget,percentile:"p90"});
    return{...candidate,inputTokens,inputTokenMethod,tokenBudget,predictedCost};
  }

  #pickFallback(current,candidates,used,ledger,providers,context){
    if(!canUseAttemptKind(ledger,"fallback"))return null;
    return candidates.find(c=>
      c.provider!==current.provider&&c.capabilityRank>=current.capabilityRank&&
      !used.has(candidateKey(c))&&providers.isAvailable(c,context)
    )||null;
  }

  #pickEscalation(current,candidates,used,ledger,providers,context){
    if(!canUseAttemptKind(ledger,"escalation"))return null;
    return candidates.find(c=>{
      if(used.has(candidateKey(c))||!providers.isAvailable(c,context))return false;
      return c.capabilityRank>current.capabilityRank||
        (c.capabilityRank===current.capabilityRank&&(EFFORT_RANK[c.effort]||0)>(EFFORT_RANK[current.effort]||0));
    })||null;
  }

  async #verifyIndependent({taskText,answer,primary,primaryCandidate,candidates,providers,plan,context,ledger,trace,parentAttemptNumber}){
    const alternatives=candidates.filter(c=>candidateKey(c)!==candidateKey(primaryCandidate));
    const attempts=[];
    for(const verifierCandidate of alternatives.slice(0,3)){
      if(!providers.isAvailable(verifierCandidate,context))continue;
      const verifier=providers.get(verifierCandidate.provider);
      const verifierTask=[
        "You are an independent verifier.",
        "Return first line exactly VERDICT: PASS or VERDICT: FAIL.",
        "Check support by the supplied task/context and flag invented facts, citations, quotations or unsupported certainty.",
        "Do not rewrite the answer.",
        "",
        "TASK",taskText,"",
        "ANSWER",answer
      ].join("\n");
      let prepared;
      try{
        prepared=await this.#prepareCandidate({candidate:verifierCandidate,provider:verifier,taskText:verifierTask,plan});
        assertNextAttemptFits({
          ledger,candidate:prepared,predictedCostUsd:prepared.predictedCost.budgetCeilingUsd,
          inputTokens:prepared.inputTokens,outputTokens:Math.min(800,prepared.tokenBudget.billedOutput.p95)
        });
      }catch(error){
        return{passed:false,status:"unavailable",reason:error?.code||"verifier_budget_blocked",failures:[{code:error?.code||"VERIFIER_PREFLIGHT_FAILED",message:"Verifier could not fit the aggregate budget."}],attempts};
      }
      const started=Date.now();
      try{
        const checked=await verifier.execute({
          model:prepared.model,system:"Independent verification only.",user:userPrompt(verifierTask,plan.optimizedContext),
          plan:{...plan,reasoning:prepared.effort,outputBudgetTokens:Math.min(800,plan.outputBudgetTokens)}
        });
        const cost=checked.costUsd!=null
          ?{status:checked.costStatus||"verified-actual",totalUsd:Number(checked.costUsd)}
          :calculateActualCost(getModel(prepared.id),checked.usage,{cacheTtl:context.cacheTtl||"5m"});
        applyAttemptUsage(ledger,{usage:checked.usage,costUsd:cost.totalUsd,latencyMs:checked.latencyMs??(Date.now()-started)});
        const same=Boolean(primary.actualModel&&checked.actualModel&&canonicalModelId(primary.actualModel)===canonicalModelId(checked.actualModel));
        const verdict=parseVerifierVerdict(checked.output);
        const record=addVerification(trace,{
          parentAttemptNumber,provider:checked.provider,requestedModel:checked.requestedModel,actualModel:checked.actualModel,
          sameActualModel:same,passed:!same&&verdict.passed,verdict:verdict.passed?"PASS":"FAIL",malformed:Boolean(verdict.malformed),
          inputTokens:checked.usage?.inputTokens,outputTokens:checked.usage?.outputTokens,totalTokens:checked.usage?.totalTokens,
          actualCostUsd:cost.totalUsd,actualCostStatus:cost.status,latencyMs:checked.latencyMs??(Date.now()-started)
        });
        attempts.push(record);
        if(same)continue;
        if(verdict.passed)return{passed:true,status:"passed",provider:checked.provider,requestedModel:checked.requestedModel,actualModel:checked.actualModel,attempts};
        return{passed:false,status:"failed",reason:"Independent verifier returned FAIL.",failures:[{code:"independent_verifier_fail",message:"Independent verifier returned FAIL."}],attempts};
      }catch(error){
        const record=addVerification(trace,{
          parentAttemptNumber,provider:prepared.provider,requestedModel:prepared.model,actualModel:null,passed:false,
          verdict:null,errorType:failureCode(error),latencyMs:Date.now()-started
        });
        attempts.push(record);
      }
    }
    return{passed:false,status:"unavailable",reason:"No distinct actual model completed independent verification.",failures:[{code:"independent_verifier_unavailable",message:"No distinct actual model completed verification."}],attempts};
  }

  async #finishFailure({plan,trace,ledger,taskText,context,code,message,firstPassSuccess=false}){
    await this.#persistFinal({plan,trace,ledger,taskText,context,outputText:null,success:false,firstPassSuccess,failureClass:code});
    return failureResult(plan,code,message,trace.attempts,{verifications:trace.verifications,budgetRemaining:remainingBudget(ledger)});
  }

  async #persistFinal({plan,trace,ledger,taskText,context,outputText,success,firstPassSuccess=false,failureClass=null,provider=null,requestedModel=null,actualModel=null}){
    const final=finishTrace(trace,{
      project:plan.project?.name,feature:plan.feature,taskClass:plan.task,
      provider:provider||trace.attempts.at(-1)?.provider||null,
      requestedModel:requestedModel||trace.attempts.at(-1)?.requestedModel||null,
      actualModel:actualModel||trace.attempts.at(-1)?.actualModel||null,
      reasoningLevel:trace.attempts.at(-1)?.reasoningLevel||plan.reasoning,
      totalActualCostUsd:ledger.unknownCost?null:ledger.actual.costUsd,
      totalInputTokens:ledger.actual.inputTokens,totalOutputTokens:ledger.actual.outputTokens,totalTokens:ledger.actual.totalTokens,
      totalLatencyMs:Date.now()-ledger.startedAt,retryCount:ledger.retries,fallbackCount:ledger.fallbacks,escalationCount:ledger.escalations,
      firstPassSuccess,finalVerifiedSuccess:success,qualityScore:context.qualityScore,failureClass
    });
    const bundle=bundleTrace(trace,final);
    await this.outcomeStore.writeBundle(bundle);
    if(this.outcomeSink){
      await legacyRecordOutcome({
        project:plan.project?.name,feature:plan.feature,taskClass:plan.task,taskText,outputText,
        workflow:{id:plan.workflow.id,version:plan.workflow.version},prompt:{id:plan.prompt.id,version:plan.prompt.version},
        provider:final.provider,requestedModel:final.requestedModel,actualModel:final.actualModel,
        reasoningLevel:plan.reasoning,tools:plan.tools,
        usage:{inputTokens:ledger.actual.inputTokens,outputTokens:ledger.actual.outputTokens,totalTokens:ledger.actual.totalTokens},
        costUsd:final.totalActualCostUsd,latencyMs:final.totalLatencyMs,retries:ledger.retries,
        fallbacks:trace.attempts.filter(x=>x.attemptKind==="fallback"),validation:null,verification:null,
        qualityScore:context.qualityScore,success,failureReason:failureClass
      },this.repoRoot,this.outcomeSink);
    }
    return bundle;
  }

  async recordOutcome(record){
    return legacyRecordOutcome(record,this.repoRoot,this.outcomeSink);
  }

  async stats(){
    const records=await this.outcomeStore.readRecords();
    return{metrics:computeMetrics(records),taskModel:groupTaskModelStats(records),records:records.length};
  }
}
