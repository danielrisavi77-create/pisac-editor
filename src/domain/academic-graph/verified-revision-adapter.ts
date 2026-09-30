import type{VerifiedObjectActivity}from"@/domain/forensics/verified-object-activity";import{beginAcademicRevisionDraft,type AcademicRevisionLedger}from"./academic-revision-lifecycle";import type{AcademicObjectNodeBinding}from"./academic-object-registry";
export function applyVerifiedActivityToRevisionDraft(ledger:AcademicRevisionLedger,input:{objectId:string;baseRevision:number;binding:AcademicObjectNodeBinding;activity:readonly VerifiedObjectActivity[];draftId:string;openedAt:string}):AcademicRevisionLedger{
 if(input.binding.objectId!==input.objectId)throw new Error("verified-revision: binding object mismatch");
 const refs=input.activity.filter(x=>x.objectId===input.objectId&&x.nodeId===input.binding.nodeId).map(x=>({sessionId:x.sessionId,eventIndexes:x.eventIndexes}));
 if(!refs.length)return ledger;
 return beginAcademicRevisionDraft(ledger,{draftId:input.draftId,objectId:input.objectId,baseRevision:input.baseRevision,bindingId:input.binding.bindingId,openedAt:input.openedAt,activity:refs});
}
