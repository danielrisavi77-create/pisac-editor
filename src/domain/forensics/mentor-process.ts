import type{ForensicEvent}from"./ledger";import{analyzeWritingRhythm}from"./rhythm";import{projectSemanticProvenance,type SemanticProvenanceKind}from"./semantic";
export type ProcessFilter="all"|SemanticProvenanceKind;
export type MentorProcessView={integrity:"verified"|"unverified";eventCount:number;rhythm:ReturnType<typeof analyzeWritingRhythm>;timeline:ReturnType<typeof projectSemanticProvenance>};

export function buildMentorProcessView(input:{events:readonly ForensicEvent[];integrityVerified:boolean;filter?:ProcessFilter;visibleThroughSequence:number}):MentorProcessView{
 if(!Number.isSafeInteger(input.visibleThroughSequence)||input.visibleThroughSequence<0)throw new Error("buildMentorProcessView: invalid visibility boundary");
 const visible=input.events.filter(e=>e.sequence<=input.visibleThroughSequence);
 const semantic=projectSemanticProvenance(visible);
 return{integrity:input.integrityVerified?"verified":"unverified",eventCount:visible.length,rhythm:analyzeWritingRhythm(visible),timeline:input.filter&&input.filter!=="all"?semantic.filter(x=>x.kind===input.filter):semantic};
}
export function forensicDrillDown(events:readonly ForensicEvent[],sourceEventIds:readonly string[],visibleThroughSequence:number):ForensicEvent[]{
 const wanted=new Set(sourceEventIds);return events.filter(e=>e.sequence<=visibleThroughSequence&&wanted.has(e.id)).sort((a,b)=>a.sequence-b.sequence).map(e=>structuredClone(e));
}
