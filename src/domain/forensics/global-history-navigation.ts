import type{ProcessHistory}from"./process-history";
export type GlobalHistoryStep=
 |{kind:"session-start";sessionId:string}
 |{kind:"event";sessionId:string;eventIndex:number}
 |{kind:"gap";fromSessionId:string;toSessionId:string;durationMs:number;precededByInterruption:boolean};
export function buildGlobalHistorySteps(history:ProcessHistory):GlobalHistoryStep[]{
 if(!history.valid)return[];const out:GlobalHistoryStep[]=[];
 for(const item of history.timeline){
  if(item.kind==="gap"){out.push({kind:"gap",fromSessionId:item.fromSessionId,toSessionId:item.toSessionId,durationMs:item.durationMs,precededByInterruption:item.precededByInterruption});continue;}
  out.push({kind:"session-start",sessionId:item.sessionId});for(let i=0;i<item.eventCount;i++)out.push({kind:"event",sessionId:item.sessionId,eventIndex:i});
 }
 return out;
}
export function moveGlobalHistoryCursor(steps:readonly GlobalHistoryStep[],cursor:number,direction:-1|1):number{
 if(!steps.length)return-1;if(cursor===-1&&direction===1)return 0;if(!Number.isSafeInteger(cursor)||cursor<0||cursor>=steps.length)return-1;return Math.max(0,Math.min(steps.length-1,cursor+direction));
}
