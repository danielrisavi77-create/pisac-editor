import type{AcademicObjectNodeBinding}from"./academic-object-registry";import type{SealedAcademicRevision}from"./academic-revision-lifecycle";
export type RevisionRegistryRepair={objectId:string;objectType:AcademicObjectNodeBinding["objectType"];objectRevision:number;nodeId:string;boundAt:string};
export function requiredRevisionRegistryRepair(binding:AcademicObjectNodeBinding|null,revisions:readonly SealedAcademicRevision[],objectId:string):RevisionRegistryRepair|null{
 if(!binding)return null;const latest=revisions.filter(x=>x.objectId===objectId).sort((a,b)=>a.revision-b.revision).at(-1);if(!latest||latest.revision===binding.objectRevision)return null;if(latest.revision!==binding.objectRevision+1||latest.bindingId!==binding.bindingId)throw new Error("revision-registry: unsafe mismatch");return{objectId,objectType:binding.objectType,objectRevision:latest.revision,nodeId:binding.nodeId,boundAt:latest.sealedAt};
}
