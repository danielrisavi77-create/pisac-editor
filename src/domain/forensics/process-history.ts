export type HistorySegmentStatus="sealed"|"interrupted";
export type HistorySegmentInput={sessionId:string;startedAt:string;updatedAt:string;status:HistorySegmentStatus;headHash:string;previousSessionHead:string|null;eventCount:number};
export type HistoryIssue={kind:"invalid-time"|"invalid-event-count"|"invalid-bundle"|"active-segment"|"broken-link"|"overlap"|"duplicate-session";sessionId:string};
export type HistorySegmentItem=HistorySegmentInput&{kind:"segment";globalEventStart:number;globalEventEnd:number};
export type HistoryGapItem={kind:"gap";fromSessionId:string;toSessionId:string;startedAt:string;endedAt:string;durationMs:number;precededByInterruption:boolean};
export type ProcessHistory={valid:boolean;segments:readonly HistorySegmentItem[];timeline:readonly(HistorySegmentItem|HistoryGapItem)[];issues:readonly HistoryIssue[];totalEvents:number};

function stableOrder(a:HistorySegmentInput,b:HistorySegmentInput):number{
 return Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.sessionId.localeCompare(b.sessionId);
}
function orderByParentChain(input:readonly HistorySegmentInput[],issues:HistoryIssue[]):HistorySegmentInput[]{
 const unique:HistorySegmentInput[]=[];const seenSessions=new Set<string>();const seenHeads=new Map<string,string>();
 for(const raw of input){
  if(seenSessions.has(raw.sessionId)){issues.push({kind:"duplicate-session",sessionId:raw.sessionId});continue;}
  seenSessions.add(raw.sessionId);unique.push(raw);
  const prior=seenHeads.get(raw.headHash);if(prior!==undefined){issues.push({kind:"broken-link",sessionId:prior});issues.push({kind:"broken-link",sessionId:raw.sessionId});}
  else seenHeads.set(raw.headHash,raw.sessionId);
 }
 if(!unique.length)return[];
 const roots=unique.filter(x=>x.previousSessionHead===null);
 if(roots.length!==1){
  const affected=roots.length?roots:unique;
  for(const row of affected)issues.push({kind:"broken-link",sessionId:row.sessionId});
  return[...unique].sort(stableOrder);
 }
 const children=new Map<string,HistorySegmentInput[]>();
 for(const row of unique){
  if(row.previousSessionHead===null)continue;
  const xs=children.get(row.previousSessionHead)??[];xs.push(row);children.set(row.previousSessionHead,xs);
 }
 for(const xs of children.values())if(xs.length>1)for(const row of xs)issues.push({kind:"broken-link",sessionId:row.sessionId});
 const ordered:HistorySegmentInput[]=[];const visited=new Set<string>();let current:HistorySegmentInput|undefined=roots[0];
 while(current){
  if(visited.has(current.sessionId)){issues.push({kind:"broken-link",sessionId:current.sessionId});break;}
  visited.add(current.sessionId);ordered.push(current);
  const next=[...(children.get(current.headHash)??[])].sort(stableOrder);
  current=next[0];
 }
 for(const row of unique)if(!visited.has(row.sessionId)){issues.push({kind:"broken-link",sessionId:row.sessionId});ordered.push(row);}
 return ordered;
}

export function buildProcessHistory(input:readonly HistorySegmentInput[]):ProcessHistory{
 const issues:HistoryIssue[]=[];const ordered=orderByParentChain(input,issues);const segments:HistorySegmentItem[]=[];const timeline:(HistorySegmentItem|HistoryGapItem)[]=[];let cursor=0;let previous:HistorySegmentItem|null=null;
 for(const raw of ordered){
  const start=Date.parse(raw.startedAt),end=Date.parse(raw.updatedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start){issues.push({kind:"invalid-time",sessionId:raw.sessionId});continue;}
  if(previous){
   if(raw.previousSessionHead!==previous.headHash)issues.push({kind:"broken-link",sessionId:raw.sessionId});
   if(start<Date.parse(previous.updatedAt))issues.push({kind:"overlap",sessionId:raw.sessionId});
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
