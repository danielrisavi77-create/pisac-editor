function estimateTokens(text){
  return Math.max(0,Math.ceil(String(text||"").length/3.6));
}
function normalize(text){
  return String(text||"").trim().replace(/\s+/g," ").toLowerCase();
}
function queryTerms(prompt){
  return new Set(String(prompt||"").toLowerCase().match(/[\p{L}\p{N}_-]{4,}/gu)?.slice(0,80)||[]);
}
const MANDATORY_TYPES=new Set([
  "security","policy","instruction","error","test","stack_trace",
  "evidence","retrieval","source","citation","verification"
]);
function segmentScore(segment,terms,index,total){
  let score=Number(segment.priority||0);
  if(segment.pinned) score+=2000;
  if(MANDATORY_TYPES.has(segment.type)) score+=1500;
  if(["system","project"].includes(segment.type)) score+=700;
  if(segment.type==="previous_failure") score+=600;
  const text=String(segment.text||"").toLowerCase();
  let matches=0;
  for(const term of terms) if(text.includes(term)) matches++;
  score+=Math.min(240,matches*20);
  score+=total>1?Math.round((index/(total-1))*20):20;
  return score;
}

export function optimizeContext({
  prompt,
  context="",
  contextSegments=[],
  maxContextTokens=32000,
  reservedOutputTokens=0
}={}){
  const source=[];
  if(context){
    String(context).split(/\n{2,}/).filter(Boolean).forEach((text,index)=>{
      source.push({text,type:"legacy",source:"context",index});
    });
  }
  contextSegments.forEach((segment,index)=>{
    if(segment?.text) source.push({type:"user",...segment,index:source.length+index});
  });
  const beforeTokens=source.reduce((sum,s)=>sum+estimateTokens(s.text),0);
  const seen=new Set();
  const deduped=[];
  for(const segment of source){
    const key=normalize(segment.text);
    if(!key||seen.has(key)) continue;
    seen.add(key); deduped.push(segment);
  }
  const mandatory=deduped.filter((s)=>s.pinned||MANDATORY_TYPES.has(s.type));
  const mandatoryTokens=mandatory.reduce((sum,s)=>sum+estimateTokens(s.text),0);
  const available=Math.max(0,Number(maxContextTokens||0)-Math.max(0,Number(reservedOutputTokens)||0));
  if(mandatoryTokens>available){
    const error=new Error("Critical context exceeds the available context budget.");
    error.code="CRITICAL_CONTEXT_BUDGET_EXCEEDED";
    error.mandatoryTokens=mandatoryTokens;
    error.availableTokens=available;
    throw error;
  }

  const terms=queryTerms(prompt);
  const ranked=deduped.map((segment,index)=>({
    ...segment,
    estimatedTokens:estimateTokens(segment.text),
    score:segmentScore(segment,terms,index,deduped.length)
  })).sort((a,b)=>b.score-a.score||a.estimatedTokens-b.estimatedTokens);

  const selected=[];
  const selectedKeys=new Set();
  let used=0;
  for(const segment of ranked){
    const key=normalize(segment.text);
    const isMandatory=segment.pinned||MANDATORY_TYPES.has(segment.type);
    if(isMandatory||used+segment.estimatedTokens<=available){
      selected.push(segment);
      selectedKeys.add(key);
      used+=segment.estimatedTokens;
    }
  }
  selected.sort((a,b)=>(a.index||0)-(b.index||0));
  const text=selected.map(x=>x.text).join("\n\n");
  const afterTokens=estimateTokens(text);
  return {
    text,
    segments:selected.map(({text:_text,...meta})=>meta),
    stats:{
      tokensBefore:beforeTokens,
      tokensAfter:afterTokens,
      tokensSaved:Math.max(0,beforeTokens-afterTokens),
      percentageSaved:beforeTokens?round2(((beforeTokens-afterTokens)/beforeTokens)*100):0,
      sourceSegments:source.length,
      selectedSegments:selected.length,
      duplicateSegmentsRemoved:source.length-deduped.length,
      truncated:selected.length<deduped.length,
      mandatorySegments:mandatory.length,
      mandatoryTokens,
      reservedOutputTokens:Math.max(0,Number(reservedOutputTokens)||0)
    },
    method:"deterministic-relevance-v0.3"
  };
}

export function roughInputTokens({prompt="",context="",instructions=""}={}){
  return Math.max(1,estimateTokens(String(instructions)+"\n"+String(context)+"\n"+String(prompt))+24);
}
function round2(v){return Math.round(v*100)/100;}
