export class UsagePolicy {
  constructor({
    requireIdentity=true,
    tiers={},
    defaultTier="free",
    blockedTaskTypes=[]
  }={}){
    this.requireIdentity=requireIdentity;
    this.tiers=tiers;
    this.defaultTier=defaultTier;
    this.blockedTaskTypes=new Set(blockedTaskTypes);
  }

  evaluate({
    userId=null,
    tier=this.defaultTier,
    feature=null,
    taskClass=null,
    dailySpendUsd=0,
    monthlySpendUsd=0,
    dailyRequests=0,
    monthlyRequests=0
  }={}){
    const reasons=[];
    if(this.requireIdentity&&!userId)reasons.push("identity_required");
    if(this.blockedTaskTypes.has(taskClass))reasons.push("task_blocked");
    const policy=this.tiers[tier]||this.tiers[this.defaultTier]||{};
    const featurePolicy=policy.features?.[feature]||{};
    const maxDailySpend=featurePolicy.maxDailySpendUsd??policy.maxDailySpendUsd;
    const maxMonthlySpend=featurePolicy.maxMonthlySpendUsd??policy.maxMonthlySpendUsd;
    const maxDailyRequests=featurePolicy.maxDailyRequests??policy.maxDailyRequests;
    const maxMonthlyRequests=featurePolicy.maxMonthlyRequests??policy.maxMonthlyRequests;
    if(maxDailySpend!=null&&dailySpendUsd>=maxDailySpend)reasons.push("daily_spend_exhausted");
    if(maxMonthlySpend!=null&&monthlySpendUsd>=maxMonthlySpend)reasons.push("monthly_spend_exhausted");
    if(maxDailyRequests!=null&&dailyRequests>=maxDailyRequests)reasons.push("daily_request_quota_exhausted");
    if(maxMonthlyRequests!=null&&monthlyRequests>=maxMonthlyRequests)reasons.push("monthly_request_quota_exhausted");
    if(Array.isArray(policy.blockedTaskTypes)&&policy.blockedTaskTypes.includes(taskClass))reasons.push("tier_task_blocked");
    return {allowed:reasons.length===0,reasons,tier,feature,taskClass};
  }
}

export function productionUsageReadiness({hasIdentity=false,hasPerUserQuota=false,hasDistributedRateLimit=false}={}){
  const missing=[];
  if(!hasIdentity)missing.push("user_identity");
  if(!hasPerUserQuota)missing.push("per_user_quota");
  if(!hasDistributedRateLimit)missing.push("distributed_rate_limit");
  return {ready:missing.length===0,missing};
}
