function percentile(values,p){
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const i=(sorted.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);
  if(lo===hi)return sorted[lo];
  return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo);
}
function rate(rows,predicate){
  return rows.length?rows.filter(predicate).length/rows.length:null;
}
export function computeMetrics(records=[]){
  const finals=records.filter(r=>r?.recordType==="final");
  const attempts=records.filter(r=>r?.recordType==="attempt");
  const costs=finals.map(r=>Number(r.totalActualCostUsd)).filter(Number.isFinite);
  const success=finals.filter(r=>r.finalVerifiedSuccess===true);
  const latencies=finals.map(r=>Number(r.totalLatencyMs)).filter(Number.isFinite);
  const predictionErrors=attempts
    .filter(r=>Number.isFinite(Number(r.predictedOutputP90))&&Number.isFinite(Number(r.actualOutputTokens))&&Number(r.actualOutputTokens)>0)
    .map(r=>Math.abs(Number(r.actualOutputTokens)-Number(r.predictedOutputP90))/Number(r.actualOutputTokens));
  const providerShare={};
  for(const r of finals){
    if(!r.provider)continue;
    providerShare[r.provider]=(providerShare[r.provider]||0)+1;
  }
  return {
    sampleSize:finals.length,
    reliable:finals.length>=30,
    requests:finals.length,
    successfulVerifiedTasks:success.length,
    firstPassSuccessRate:rate(finals,r=>r.firstPassSuccess===true),
    finalSuccessRate:rate(finals,r=>r.finalVerifiedSuccess===true),
    retryProbability:rate(finals,r=>(r.retryCount||0)>0),
    fallbackProbability:rate(finals,r=>(r.fallbackCount||0)>0),
    escalationProbability:rate(finals,r=>(r.escalationCount||0)>0),
    costPerRequestUsd:costs.length?costs.reduce((a,b)=>a+b,0)/costs.length:null,
    costPerSuccessfulVerifiedTaskUsd:success.length&&costs.length
      ? finals.reduce((sum,r)=>sum+(Number.isFinite(Number(r.totalActualCostUsd))?Number(r.totalActualCostUsd):0),0)/success.length
      : null,
    latencyMedianMs:percentile(latencies,0.5),
    latencyP90Ms:percentile(latencies,0.9),
    outputPredictionMape:predictionErrors.length?predictionErrors.reduce((a,b)=>a+b,0)/predictionErrors.length:null,
    providerShare
  };
}

export function groupTaskModelStats(records=[]){
  const groups=new Map();
  for(const r of records.filter(x=>x?.recordType==="attempt")){
    const key=[r.taskClass,r.provider,r.requestedModel,r.reasoningLevel].join("|");
    const g=groups.get(key)||{key,taskClass:r.taskClass,provider:r.provider,model:r.requestedModel,reasoningLevel:r.reasoningLevel,attempts:0,successes:0,costs:[],latencies:[]};
    g.attempts++; if(r.success)g.successes++;
    if(Number.isFinite(Number(r.actualCostUsd)))g.costs.push(Number(r.actualCostUsd));
    if(Number.isFinite(Number(r.latencyMs)))g.latencies.push(Number(r.latencyMs));
    groups.set(key,g);
  }
  return [...groups.values()].map(g=>({
    key:g.key,taskClass:g.taskClass,provider:g.provider,model:g.model,reasoningLevel:g.reasoningLevel,
    attempts:g.attempts,verifiedSuccessRate:g.attempts?g.successes/g.attempts:null,
    averageCostUsd:g.costs.length?g.costs.reduce((a,b)=>a+b,0)/g.costs.length:null,
    medianLatencyMs:percentile(g.latencies,0.5),
    reliable:g.attempts>=30
  }));
}
