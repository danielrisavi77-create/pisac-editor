import type{AcademicObjectNodeBinding,NewAcademicObjectBinding}from"./academic-object-registry";import type{SealedAcademicRevision}from"./academic-revision-lifecycle";
export type RevisionRegistryRepair=Omit<NewAcademicObjectBinding,"bindingId">;
export function requiredRevisionRegistryRepair(binding:AcademicObjectNodeBinding|null,revisions:readonly SealedAcademicRevision[]):RevisionRegistryRepair|null{
 if(!binding)return null;
 const latest=revisions.filter(x=>x.documentId===binding.documentId&&x.objectId===binding.objectId).sort((a,b)=>a.revision-b.revision).at(-1);
 if(!latest||latest.revision===binding.objectRevision)return null;
 if(latest.revision!==binding.objectRevision+1||latest.bindingId!==binding.bindingId||Date.parse(latest.sealedAt)<=Date.parse(binding.boundAt))throw new Error("revision-registry: unsafe mismatch");
 return{documentId:binding.documentId,objectId:binding.objectId,objectType:binding.objectType,objectRevision:latest.revision,nodeId:binding.nodeId,boundAt:latest.sealedAt};
}
