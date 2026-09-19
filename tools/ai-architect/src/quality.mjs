export function estimateQuality({model,calibration=null,minSamples=30}={}){
  if((calibration?.verifiedSampleCount||0)>=minSamples&&calibration.finalSuccessRate!=null){
    return {
      source:"production-empirical",
      successProbability:prob(calibration.finalSuccessRate),
      firstPassSuccessProbability:prob(calibration.firstPassSuccessRate),
      retryProbability:prob(calibration.retryRate),
      fallbackProbability:prob(calibration.fallbackRate),
      escalationProbability:prob(calibration.escalationRate),
      sampleCount:Number(calibration.verifiedSampleCount)||0,
      capabilityRank:model?.capabilityRank??null
    };
  }
  return {
    source:"registry-capability-only",
    successProbability:null,
    firstPassSuccessProbability:null,
    retryProbability:null,
    fallbackProbability:null,
    escalationProbability:null,
    sampleCount:0,
    capabilityRank:model?.capabilityRank??null,
    note:"No success probability is asserted until enough verified production outcomes exist."
  };
}
function prob(v){
  if(v==null||!Number.isFinite(Number(v))) return null;
  return Math.max(0,Math.min(1,Number(v)));
}
