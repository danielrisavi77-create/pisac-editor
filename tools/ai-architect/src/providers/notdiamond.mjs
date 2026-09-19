export function createNotDiamondSelector(config={},runtime={}){
  const env=runtime.env||process.env;
  return{
    id:"notdiamond",
    kind:"selector",
    available(){return Boolean(config.enabled&&env[config.keyEnv||"NOTDIAMOND_API_KEY"]);},
    readiness({
      totalVerified=0,
      perTask={},
      labelCoverage=0,
      challengerCount=0,
      minTotal=config.minOutcomes||100,
      minPerTask=config.minPerTask||30,
      minLabelCoverage=config.minLabelCoverage||0.9,
      minChallengers=config.minChallengers||2
    }={}){
      const taskEntries=Object.entries(perTask||{});
      const underSampled=taskEntries.filter(([,n])=>Number(n)<Number(minPerTask)).map(([task,n])=>({task,count:Number(n)||0}));
      const checks={
        enabled:Boolean(config.enabled),
        keyPresent:Boolean(env[config.keyEnv||"NOTDIAMOND_API_KEY"]),
        totalVerified:Number(totalVerified)>=Number(minTotal),
        perTaskSufficient:taskEntries.length>0&&underSampled.length===0,
        labelCoverage:Number(labelCoverage)>=Number(minLabelCoverage),
        challengers:Number(challengerCount)>=Number(minChallengers)
      };
      const ready=Object.values(checks).every(Boolean);
      const missing=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
      return{
        ready,checks,missing,
        evidence:{
          totalVerified:Number(totalVerified)||0,minTotal:Number(minTotal),
          perTask,underSampled,minPerTask:Number(minPerTask),
          labelCoverage:Number(labelCoverage)||0,minLabelCoverage:Number(minLabelCoverage),
          challengerCount:Number(challengerCount)||0,minChallengers:Number(minChallengers)
        }
      };
    },
    async select(){
      throw new Error("Not Diamond routing is intentionally inactive in AI Architect v0.3. Use readiness() only.");
    }
  };
}
