import type{ForensicEvent}from"./ledger";import{analyzeWritingRhythm}from"./rhythm";import{projectSemanticProvenance,type SemanticProvenanceKind}from"./semantic";
export type ProcessFilter="all"|SemanticProvenanceKind;
export type MentorVisibilityScope={throughSequence:number;allowedRevisions?:readonly number[];allowedNodeIds?:readonly string[]};
export type MentorProcessView={integrity:"verified"|"unverified";eventCount:number;rhythm:ReturnType<typeof analyzeWritingRhythm>;timeline:ReturnType<typeof projectSemanticProvenance>};
function nodeIdOf(e:ForensicEvent):string|null{const p=e.payload;return"nodeId"in p&&typeof p.nodeId==="string"?p.nodeId:null;}
function visible(e:ForensicEvent,scope:MentorVisibilityScope):boolean{
 if(e.sequence>scope.throughSequence)return false;
 if(scope.allowedRevisions&& !scope.allowedRevisions.includes(e.revision))return false;
 const node=nodeIdOf(e);if(scope.allowedNodeIds&&node!==null&&!scope.allowedNodeIds.includes(node))return false;
 return true;
}
export function buildMentorProcessView(input:{events:readonly ForensicEvent[];integrityVerified:boolean;filter?:ProcessFilter;scope:MentorVisibilityScope}):MentorProcessView{
 if(!Number.isSafeInteger(input.scope.throughSequence)||input.scope.throughSequence<0)throw new Error("buildMentorProcessView: invalid visibility boundary");
 const scoped=input.events.filter(e=>visible(e,input.scope));const semantic=projectSemanticProvenance(scoped);
 return{integrity:input.integrityVerified?"verified":"unverified",eventCount:scoped.length,rhythm:analyzeWritingRhythm(scoped),timeline:input.filter&&input.filter!=="all"?semantic.filter(x=>x.kind===input.filter):semantic};
}
export function forensicDrillDown(events:readonly ForensicEvent[],sourceEventIds:readonly string[],scope:MentorVisibilityScope):ForensicEvent[]{
 const wanted=new Set(sourceEventIds);return events.filter(e=>visible(e,scope)&&wanted.has(e.id)).sort((a,b)=>a.sequence-b.sequence).map(e=>structuredClone(e));
}
