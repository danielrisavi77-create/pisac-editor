import type{AcademicObjectType}from"./academic-graph";
export type AcademicObjectNodeBinding={bindingId:string;objectId:string;objectType:AcademicObjectType;objectRevision:number;nodeId:string;boundAt:string;bindingVersion:number;previousBindingId:string|null};
export type AcademicObjectRegistry={bindings:readonly AcademicObjectNodeBinding[]};
export type NewAcademicObjectBinding=Omit<AcademicObjectNodeBinding,"bindingVersion"|"previousBindingId">;
export function currentAcademicObjectBinding(registry:AcademicObjectRegistry,objectId:string):AcademicObjectNodeBinding|null{
 const xs=registry.bindings.filter(x=>x.objectId===objectId).sort((a,b)=>a.bindingVersion-b.bindingVersion);return xs.at(-1)??null;
}
export function appendAcademicObjectBinding(registry:AcademicObjectRegistry,input:NewAcademicObjectBinding):AcademicObjectRegistry{
 if(!input.bindingId.trim()||!input.objectId.trim()||!input.nodeId.trim()||!Number.isSafeInteger(input.objectRevision)||input.objectRevision<1||!Number.isFinite(Date.parse(input.boundAt)))throw new Error("academic-object-registry: invalid binding");
 if(registry.bindings.some(x=>x.bindingId===input.bindingId))throw new Error("academic-object-registry: duplicate binding");
 const previous=currentAcademicObjectBinding(registry,input.objectId);
 if(previous){if(previous.objectType!==input.objectType)throw new Error("academic-object-registry: object type changed");if(input.objectRevision<previous.objectRevision)throw new Error("academic-object-registry: revision rollback");if(Date.parse(input.boundAt)<Date.parse(previous.boundAt))throw new Error("academic-object-registry: time rollback");if(previous.nodeId===input.nodeId&&previous.objectRevision===input.objectRevision)throw new Error("academic-object-registry: duplicate state");}
 const next:AcademicObjectNodeBinding={...input,bindingVersion:(previous?.bindingVersion??0)+1,previousBindingId:previous?.bindingId??null};
 return{bindings:[...registry.bindings,next]};
}
