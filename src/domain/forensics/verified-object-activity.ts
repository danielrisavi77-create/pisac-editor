import type{Schema}from"@tiptap/pm/model";import type{AcademicObjectBindingInterval}from"@/domain/academic-graph/academic-object-registry";import type{VerifiedHistorySegment}from"./verified-process-history";import{deriveVerifiedObjectBinding}from"./verified-object-binding";
export type VerifiedObjectActivity={objectId:string;nodeId:string;sessionId:string;eventIndexes:readonly number[];beforeText:string;afterText:string;startedAt:string};
export async function deriveVerifiedObjectActivity(intervals:readonly AcademicObjectBindingInterval[],segments:readonly VerifiedHistorySegment[],schema:Schema):Promise<VerifiedObjectActivity[]>{
 const out:VerifiedObjectActivity[]=[];
 for(const interval of intervals)for(const s of segments){const b=await deriveVerifiedObjectBinding(s.bundle,schema,{objectId:interval.binding.objectId,objectType:interval.binding.objectType,nodeId:interval.binding.nodeId,revision:interval.binding.objectRevision,evidenceIds:[],effectiveFrom:interval.effectiveFrom,effectiveUntil:interval.effectiveUntil});if(b)out.push({objectId:b.objectId,nodeId:b.nodeId,sessionId:b.sessionId,eventIndexes:b.eventIndexes,beforeText:b.beforeText,afterText:b.afterText,startedAt:s.record.startedAt});}
 return out.sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.sessionId.localeCompare(b.sessionId));
}
