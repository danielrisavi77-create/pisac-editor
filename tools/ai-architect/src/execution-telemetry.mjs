import { createHash, randomUUID } from "node:crypto";

export function newExecutionTrace(plan,taskText){
  return {
    requestId:randomUUID(),
    startedAt:Date.now(),
    attempts:[],
    verifications:[],
    request:{
      requestId:null,
      createdAt:new Date().toISOString(),
      project:plan.project?.name||null,
      feature:plan.feature||null,
      taskClass:plan.task,
      risk:plan.risk,
      complexity:plan.complexity,
      profile:plan.profile,
      workflowId:plan.workflow.id,
      workflowVersion:plan.workflow.version,
      promptId:plan.prompt.id,
      promptVersion:plan.prompt.version,
      contextTokensBefore:plan.contextBudget?.optimized?.tokensBefore??null,
      contextTokensAfter:plan.contextBudget?.optimized?.tokensAfter??null,
      promptFingerprint:fingerprint(taskText)
    }
  };
}

export function addAttempt(trace,data={}){
  const record={
    requestId:trace.requestId,
    attemptNumber:trace.attempts.length+1,
    attemptKind:data.attemptKind||"initial",
    taskClass:data.taskClass||null,
    provider:data.provider||null,
    requestedModel:data.requestedModel||null,
    actualModel:data.actualModel||null,
    reasoningLevel:data.reasoningLevel||null,
    inputTokenMethod:data.inputTokenMethod||null,
    predictedInputTokens:num(data.predictedInputTokens),
    actualInputTokens:num(data.actualInputTokens),
    predictedOutputP50:num(data.predictedOutputP50),
    predictedOutputP90:num(data.predictedOutputP90),
    predictedOutputP95:num(data.predictedOutputP95),
    predictedReasoningP90:num(data.predictedReasoningP90),
    actualOutputTokens:num(data.actualOutputTokens),
    actualVisibleOutputTokens:num(data.actualVisibleOutputTokens),
    actualReasoningTokens:num(data.actualReasoningTokens),
    cacheReadTokens:num(data.cacheReadTokens),
    cacheWriteTokens:num(data.cacheWriteTokens),
    predictedCostUsd:num(data.predictedCostUsd),
    predictedBudgetCeilingUsd:num(data.predictedBudgetCeilingUsd),
    actualCostUsd:num(data.actualCostUsd),
    actualCostStatus:data.actualCostStatus||"unknown",
    latencyMs:num(data.latencyMs),
    contractPassed:data.contractPassed??null,
    success:Boolean(data.success),
    errorType:data.errorType||null,
    transientError:data.transientError??null,
    createdAt:new Date().toISOString()
  };
  trace.attempts.push(record);return record;
}

export function addVerification(trace,data={}){
  const record={
    verificationId:randomUUID(),
    requestId:trace.requestId,
    parentAttemptNumber:data.parentAttemptNumber||null,
    provider:data.provider||null,
    requestedModel:data.requestedModel||null,
    actualModel:data.actualModel||null,
    sameActualModel:Boolean(data.sameActualModel),
    passed:Boolean(data.passed),
    verdict:data.verdict||null,
    malformed:Boolean(data.malformed),
    inputTokens:num(data.inputTokens),
    outputTokens:num(data.outputTokens),
    totalTokens:num(data.totalTokens),
    actualCostUsd:num(data.actualCostUsd),
    actualCostStatus:data.actualCostStatus||"unknown",
    latencyMs:num(data.latencyMs),
    errorType:data.errorType||null,
    createdAt:new Date().toISOString()
  };
  trace.verifications.push(record);return record;
}

export function finishTrace(trace,data={}){
  return {
    requestId:trace.requestId,
    createdAt:new Date().toISOString(),
    project:data.project||null,
    feature:data.feature||null,
    taskClass:data.taskClass||null,
    provider:data.provider||null,
    requestedModel:data.requestedModel||null,
    actualModel:data.actualModel||null,
    reasoningLevel:data.reasoningLevel||null,
    totalActualCostUsd:num(data.totalActualCostUsd),
    totalInputTokens:num(data.totalInputTokens),
    totalOutputTokens:num(data.totalOutputTokens),
    totalTokens:num(data.totalTokens),
    totalLatencyMs:num(data.totalLatencyMs),
    retryCount:Number(data.retryCount)||0,
    fallbackCount:Number(data.fallbackCount)||0,
    escalationCount:Number(data.escalationCount)||0,
    firstPassSuccess:Boolean(data.firstPassSuccess),
    finalVerifiedSuccess:Boolean(data.finalVerifiedSuccess),
    qualityScore:num(data.qualityScore),
    failureClass:data.failureClass||null
  };
}

export function bundleTrace(trace,final){
  trace.request.requestId=trace.requestId;
  return {request:trace.request,attempts:trace.attempts,verifications:trace.verifications,final};
}
function fingerprint(value){return createHash("sha256").update(String(value||"")).digest("hex");}
function num(v){if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
