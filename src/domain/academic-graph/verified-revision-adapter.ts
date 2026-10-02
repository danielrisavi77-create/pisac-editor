import type{VerifiedObjectActivity}from"@/domain/forensics/verified-object-activity";import{beginAcademicRevisionDraft,type AcademicRevisionDraft,type AcademicRevisionLedger}from"./academic-revision-lifecycle";import type{AcademicObjectNodeBinding}from"./academic-object-registry";

export function revisionDraftFromVerifiedActivity(input:{binding:AcademicObjectNodeBinding;activity:readonly VerifiedObjectActivity[];draftId:string}):AcademicRevisionDraft|null{
 const matching=input.activity.filter(x=>x.documentId===input.binding.documentId&&x.objectId===input.binding.objectId&&x.bindingId===input.binding.bindingId&&x.nodeId===input.binding.nodeId);
 if(!matching.length)return null;
 const first=matching[0],last=matching.at(-1)!;
 return{draftId:input.draftId,documentId:input.binding.documentId,objectId:input.binding.objectId,baseRevision:input.binding.objectRevision,bindingId:input.binding.bindingId,openedAt:first.startedAt,activity:matching.map(x=>({sessionId:x.sessionId,eventIndexes:x.eventIndexes})),afterText:last.afterText};
}
export function applyVerifiedActivityToRevisionDraft(ledger:AcademicRevisionLedger,input:{binding:AcademicObjectNodeBinding;activity:readonly VerifiedObjectActivity[];draftId:string}):AcademicRevisionLedger{
 const draft=revisionDraftFromVerifiedActivity(input);return draft?beginAcademicRevisionDraft(ledger,draft):ledger;
}
