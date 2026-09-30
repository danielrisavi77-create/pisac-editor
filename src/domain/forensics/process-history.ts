export type HistorySegmentStatus="sealed"|"interrupted";
export type HistorySegmentInput={sessionId:string;startedAt:string;updatedAt:string;status:HistorySegmentStatus;headHash:string;previousSessionHead:string|null;eventCount:number};
export type HistoryIssue={kind:"invalid-time"|"invalid-event-count"|"invalid-bundle"|"active-segment"|"broken-link"|"overlap"|"duplicate-session";sessionId:string};
export type HistorySegmentItem=HistorySegmentInput&{kind:"segment";globalEventStart:number;globalEventEnd:number};
export type HistoryGapItem={kind:"gap";fromSessionId:string;toSessionId:string;startedAt:string;endedAt:string;durationMs:number;precededByInterruption:boolean};
export type ProcessHistory={valid:boolean;segments:readonly HistorySegmentItem[];timeline:readonly(HistorySegmentItem|HistoryGapItem)[];issues:readonly HistoryIssue[];totalEvents:number};

export function buildProcessHistory(input:readonly HistorySegmentInput[]):ProcessHistory{
 const ordered=[...input].sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.sessionId.localeCompare(b.sessionId));const issues:HistoryIssue[]=[];const seen=new Set<string>();const segments:HistorySegmentItem[]=[];const timeline:(HistorySegmentItem|HistoryGapItem)[]=[];let cursor=0;let previous:HistorySegmentItem|null=null;
 for(const raw of ordered){
  const start=Date.parse(raw.startedAt),end=Date.parse(raw.updatedAt);
  if(seen.has(raw.sessionId)){issues.push({kind:"duplicate-session",sessionId:raw.sessionId});continue;}seen.add(raw.sessionId);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start){issues.push({kind:"invalid-time",sessionId:raw.sessionId});continue;}
  if(previous){
   if(raw.previousSessionHead!==previous.headHash)issues.push({kind:"broken-link",sessionId:raw.sessionId});
   if(start< Date.parse(previous.updatedAt))issues.push({kind:"overlap",sessionId:raw.sessionId});
   else timeline.push({kind:"gap",fromSessionId:previous.sessionId,toSessionId:raw.sessionId,startedAt:previous.updatedAt,endedAt:raw.startedAt,durationMs:start-Date.parse(previous.updatedAt),precededByInterruption:previous.status==="interrupted"});
  }else if(raw.previousSessionHead!==null)issues.push({kind:"broken-link",sessionId:raw.sessionId});
  const countValid=Number.isSafeInteger(raw.eventCount)&&raw.eventCount>=0;if(!countValid)issues.push({kind:"invalid-event-count",sessionId:raw.sessionId});const count=countValid?raw.eventCount:0;
  const segment:HistorySegmentItem={...raw,eventCount:count,kind:"segment",globalEventStart:cursor,globalEventEnd:count?cursor+count-1:cursor-1};
  segments.push(segment);timeline.push(segment);cursor+=count;previous=segment;
 }
 return{valid:issues.length===0,segments,timeline,issues,totalEvents:cursor};
}
export function locateGlobalReplayPosition(history:ProcessHistory,position:number):{sessionId:string;eventIndex:number}|null{
 if(!history.valid||!Number.isSafeInteger(position)||position<0||position>=history.totalEvents)return null;
 const s=history.segments.find(x=>position>=x.globalEventStart&&position<=x.globalEventEnd);return s?{sessionId:s.sessionId,eventIndex:position-s.globalEventStart}:null;
}
