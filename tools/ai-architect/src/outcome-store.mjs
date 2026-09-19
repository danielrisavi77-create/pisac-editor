import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class OutcomeStore {
  async writeBundle(_bundle){throw new Error("OutcomeStore.writeBundle not implemented");}
  async loadCalibration(_query){return{};}
  async readRecords(){return[];}
}

export class LocalOutcomeStore extends OutcomeStore {
  constructor({repoRoot=process.cwd(),path=null}={}){
    super();
    this.path=path||resolve(repoRoot,".ai","runtime","outcomes-v03.jsonl");
  }
  async writeBundle(bundle){
    await mkdir(dirname(this.path),{recursive:true});
    const records=flattenBundle(bundle);
    if(records.length)await appendFile(this.path,records.map(r=>JSON.stringify(r)).join("\n")+"\n","utf8");
    return {stored:true,records:records.length,backend:"local-jsonl"};
  }
  async readRecords(){
    let text="";
    try{text=await readFile(this.path,"utf8");}catch{return[];}
    return text.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  }
  async loadCalibration({taskClass}={}){
    const records=await this.readRecords();
    const finals=records.filter(r=>r.recordType==="final"&&(!taskClass||r.taskClass===taskClass));
    const attempts=records.filter(r=>r.recordType==="attempt"&&(!taskClass||r.taskClass===taskClass));
    const keys=new Set(attempts.map(r=>[r.taskClass,r.provider,r.requestedModel,r.reasoningLevel||"provider-default"].join("|")));
    const result={};
    for(const key of keys){
      const [task,provider,model,effort]=key.split("|");
      const a=attempts.filter(r=>r.taskClass===task&&r.provider===provider&&r.requestedModel===model&&(r.reasoningLevel||"provider-default")===effort);
      const requestIds=new Set(a.map(x=>x.requestId));
      const f=finals.filter(r=>requestIds.has(r.requestId));
      result[key]=summarizeCalibration(f,a);
    }
    return result;
  }
}

export class SupabaseOutcomeStore extends OutcomeStore {
  constructor({url,serviceRoleKey,fetchImpl=globalThis.fetch}={}){
    super();this.url=String(url||"").replace(/\/$/,"");this.key=serviceRoleKey;this.fetchImpl=fetchImpl;
  }
  configured(){return Boolean(this.url&&this.key);}
  headers(){return{apikey:this.key,Authorization:`Bearer ${this.key}`,"Content-Type":"application/json",Prefer:"return=minimal"};}
  async insert(table,rows){
    if(!rows?.length)return;
    const response=await this.fetchImpl(`${this.url}/rest/v1/${table}`,{method:"POST",headers:this.headers(),body:JSON.stringify(rows)});
    if(!response.ok){const e=new Error(`Supabase telemetry write failed: ${table} HTTP ${response.status}`);e.status=response.status;throw e;}
  }
  async writeBundle(bundle){
    if(!this.configured())return{stored:false,reason:"not-configured"};
    await this.insert("ai_architect_requests",[bundle.request]);
    await this.insert("ai_architect_attempts",bundle.attempts||[]);
    await this.insert("ai_architect_verifications",bundle.verifications||[]);
    await this.insert("ai_architect_results",[bundle.final]);
    return{stored:true,backend:"supabase",attempts:bundle.attempts?.length||0,verifications:bundle.verifications?.length||0};
  }
  async loadCalibration({taskClass}={}){
    if(!this.configured()||!taskClass)return{};
    const q=new URLSearchParams({select:"*",task_class:"eq."+taskClass,verified_sample_count:"gte.20",limit:"200"});
    const response=await this.fetchImpl(`${this.url}/rest/v1/ai_architect_calibration_stats?${q}`,{headers:this.headers()});
    if(!response.ok)return{};
    const rows=await response.json();
    const result={};
    for(const row of rows||[]){
      const key=[row.task_class,row.provider,row.model,row.reasoning_level||"provider-default"].join("|");
      result[key]={
        sampleCount:Number(row.sample_count||0),
        verifiedSampleCount:Number(row.verified_sample_count||0),
        outputMedian:num(row.output_median),outputP90:num(row.output_p90),outputP95:num(row.output_p95),
        reasoningMedian:num(row.reasoning_median),reasoningP90:num(row.reasoning_p90),reasoningP95:num(row.reasoning_p95),
        finalSuccessRate:num(row.final_success_rate),firstPassSuccessRate:num(row.first_pass_success_rate),
        retryRate:num(row.retry_rate),fallbackRate:num(row.fallback_rate),escalationRate:num(row.escalation_rate),
        medianLatencyMs:num(row.median_latency_ms),costPerSuccessUsd:num(row.cost_per_success_usd)
      };
    }
    return result;
  }
}

export function createOutcomeStore(env=process.env,{repoRoot=process.cwd(),fetchImpl=globalThis.fetch}={}){
  if(env.SUPABASE_URL&&env.SUPABASE_SERVICE_ROLE_KEY){
    return new SupabaseOutcomeStore({url:env.SUPABASE_URL,serviceRoleKey:env.SUPABASE_SERVICE_ROLE_KEY,fetchImpl});
  }
  return new LocalOutcomeStore({repoRoot});
}

export function flattenBundle(bundle={}){
  return [
    bundle.request&&{recordType:"request",...bundle.request},
    ...(bundle.attempts||[]).map(x=>({recordType:"attempt",...x})),
    ...(bundle.verifications||[]).map(x=>({recordType:"verification",...x})),
    bundle.final&&{recordType:"final",...bundle.final}
  ].filter(Boolean);
}

function summarizeCalibration(finals,attempts){
  const successful=finals.filter(r=>r.finalVerifiedSuccess===true);
  const sorted=(arr)=>arr.filter(Number.isFinite).sort((a,b)=>a-b);
  const pct=(arr,p)=>{const a=sorted(arr);if(!a.length)return null;const i=(a.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return l===h?a[l]:a[l]+(a[h]-a[l])*(i-l);};
  const outputs=attempts.map(a=>Number(a.actualVisibleOutputTokens)).filter(Number.isFinite);
  const reasoning=attempts.map(a=>Number(a.actualReasoningTokens)).filter(Number.isFinite);
  return {
    sampleCount:attempts.length,
    verifiedSampleCount:finals.length,
    outputMedian:pct(outputs,.5),outputP90:pct(outputs,.9),outputP95:pct(outputs,.95),
    reasoningMedian:pct(reasoning,.5),reasoningP90:pct(reasoning,.9),reasoningP95:pct(reasoning,.95),
    finalSuccessRate:finals.length?successful.length/finals.length:null,
    firstPassSuccessRate:finals.length?finals.filter(r=>r.firstPassSuccess===true).length/finals.length:null,
    retryRate:finals.length?finals.filter(r=>(r.retryCount||0)>0).length/finals.length:null,
    fallbackRate:finals.length?finals.filter(r=>(r.fallbackCount||0)>0).length/finals.length:null,
    escalationRate:finals.length?finals.filter(r=>(r.escalationCount||0)>0).length/finals.length:null,
    medianLatencyMs:pct(finals.map(r=>Number(r.totalLatencyMs)).filter(Number.isFinite),.5),
    costPerSuccessUsd:successful.length?finals.reduce((s,r)=>s+(Number.isFinite(Number(r.totalActualCostUsd))?Number(r.totalActualCostUsd):0),0)/successful.length:null
  };
}
function num(v){if(v==null)return null;const n=Number(v);return Number.isFinite(n)?n:null;}
