const OUTPUT_RATIOS={
  generic:0.34,explanation:0.25,brainstorm:0.45,grammar:0.45,translation:0.58,rewrite:0.52,
  generation:0.62,mentor_feedback:0.40,research:0.48,source_synthesis:0.46,citation_verification:0.34,
  hallucination_check:0.28,coding:0.42,architecture:0.52,security_review:0.36,document_repair:0.30,data_analysis:0.38
};
const REASONING_FACTORS={"provider-default":0.18,none:0,minimal:0.04,low:0.10,medium:0.22,high:0.38,xhigh:0.52,max:0.68};

export function predictTokenBudget({
  inputTokens,taskClass="generic",complexity=2,model,effort="provider-default",
  desiredOutputTokens=null,calibration=null
}={}){
  const cap=Number.isFinite(Number(desiredOutputTokens))&&Number(desiredOutputTokens)>0?Math.round(Number(desiredOutputTokens)):null;
  if(calibration?.sampleCount>=20&&calibration.outputMedian!=null&&calibration.outputP90!=null){
    const visibleP50=Math.max(1,Math.round(calibration.outputMedian));
    const visibleP90=Math.max(visibleP50,Math.round(calibration.outputP90));
    const visibleP95=Math.max(visibleP90,Math.round(calibration.outputP95??visibleP90*1.12));
    const reasoningP50=Math.max(0,Math.round(calibration.reasoningMedian||0));
    const reasoningP90=Math.max(reasoningP50,Math.round(calibration.reasoningP90||reasoningP50));
    const reasoningP95=Math.max(reasoningP90,Math.round(calibration.reasoningP95||reasoningP90*1.12));
    return buildBudget({visibleP50,visibleP90,visibleP95,reasoningP50,reasoningP90,reasoningP95,source:"production-empirical",sampleCount:calibration.sampleCount,model,maxBilledOutputTokens:cap});
  }
  const ratio=OUTPUT_RATIOS[taskClass]??OUTPUT_RATIOS.generic;
  const floor=complexity>=4?700:complexity>=2?320:160;
  const rawP50=clampInt(Math.round(Number(inputTokens||0)*ratio),floor,8000);
  const visibleP50=cap?Math.min(rawP50,Math.max(32,Math.round(cap*.55))):rawP50;
  const factor=REASONING_FACTORS[effort]??REASONING_FACTORS["provider-default"];
  const reasoningP50=Math.round(Number(inputTokens||0)*factor*(0.5+Math.min(1,Number(complexity||1)/5)));
  const visibleP90=clampInt(Math.ceil(visibleP50*1.5),visibleP50,16000);
  const visibleP95=clampInt(Math.ceil(visibleP50*1.72),visibleP90,22000);
  const reasoningP90=clampInt(Math.ceil(reasoningP50*1.7),reasoningP50,30000);
  const reasoningP95=clampInt(Math.ceil(reasoningP50*1.95),reasoningP90,42000);
  return buildBudget({visibleP50,visibleP90,visibleP95,reasoningP50,reasoningP90,reasoningP95,source:"heuristic",sampleCount:0,model,maxBilledOutputTokens:cap});
}

function buildBudget({visibleP50,visibleP90,visibleP95,reasoningP50,reasoningP90,reasoningP95,source,sampleCount,model,maxBilledOutputTokens=null}){
  const includes=model?.pricing?.outputIncludesReasoning!==false;
  const p50=capPair(visibleP50,reasoningP50,includes,maxBilledOutputTokens);
  const p90=capPair(visibleP90,reasoningP90,includes,maxBilledOutputTokens);
  const p95=capPair(visibleP95,reasoningP95,includes,maxBilledOutputTokens);
  // Preserve percentile monotonicity after capping.
  p90.visible=Math.max(p50.visible,p90.visible);p90.reasoning=Math.max(p50.reasoning,p90.reasoning);
  p95.visible=Math.max(p90.visible,p95.visible);p95.reasoning=Math.max(p90.reasoning,p95.reasoning);
  const billed=(p)=>includes?p.visible+p.reasoning:p.visible;
  return{
    visibleOutput:{p50:p50.visible,p90:p90.visible,p95:p95.visible},
    reasoning:{p50:p50.reasoning,p90:p90.reasoning,p95:p95.reasoning},
    billedOutput:{p50:billed(p50),p90:billed(p90),p95:billed(p95)},
    source,sampleCount,maxBilledOutputTokens
  };
}
function capPair(visible,reasoning,includes,cap){
  visible=Math.max(0,Math.round(visible));reasoning=Math.max(0,Math.round(reasoning));
  if(!cap)return{visible,reasoning};
  const billed=includes?visible+reasoning:visible;
  if(billed<=cap)return{visible,reasoning};
  if(!includes)return{visible:cap,reasoning};
  const scale=cap/Math.max(1,billed);
  let v=Math.floor(visible*scale),r=Math.floor(reasoning*scale);
  let spare=cap-v-r;
  if(spare>0){const add=Math.min(spare,Math.max(0,visible-v));v+=add;spare-=add;}
  if(spare>0)r+=spare;
  return{visible:v,reasoning:r};
}
function clampInt(v,min,max){return Math.round(Math.min(max,Math.max(min,v)));}
