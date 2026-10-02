import type{Schema}from"@tiptap/pm/model";import type{AcademicObjectBindingInterval}from"@/domain/academic-graph/academic-object-registry";import type{VerifiedHistorySegment}from"./verified-process-history";import{deriveVerifiedObjectBinding}from"./verified-object-binding";
export type VerifiedObjectActivity={documentId:string;objectId:string;bindingId:string;nodeId:string;sessionId:string;eventIndexes:readonly number[];beforeText:string;afterText:string|null;startedAt:string;endedAt:string};
export async function deriveVerifiedObjectActivity(intervals:readonly AcademicObjectBindingInterval[],segments:readonly VerifiedHistorySegment[],schema:Schema):Promise<VerifiedObjectActivity[]>{
 const out:VerifiedObjectActivity[]=[];
 for(const s of segments){
  for(const interval of intervals){
   const b=await deriveVerifiedObjectBinding(s.bundle,schema,{documentId:interval.binding.documentId,objectId:interval.binding.objectId,objectType:interval.binding.objectType,nodeId:interval.binding.nodeId,revision:interval.binding.objectRevision,effectiveFrom:interval.effectiveFrom,effectiveUntil:interval.effectiveUntil});
   if(!b)continue;
   const firstIndex=b.eventIndexes[0],lastIndex=b.eventIndexes.at(-1)!;const firstEvent=s.bundle.events[firstIndex]?.event,lastEvent=s.bundle.events[lastIndex]?.event;if(!firstEvent||!lastEvent)throw new Error("verified-object-activity: missing event");
   out.push({documentId:b.documentId,objectId:b.objectId,bindingId:interval.binding.bindingId,nodeId:b.nodeId,sessionId:b.sessionId,eventIndexes:b.eventIndexes,beforeText:b.beforeText,afterText:b.afterText,startedAt:firstEvent.occurredAt,endedAt:lastEvent.occurredAt});
  }
 }
 return out;
}
