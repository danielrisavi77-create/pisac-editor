import type{AcademicObject,AcademicPath}from"../academic-graph";import type{SemanticProvenanceItem}from"../forensics";
export type ReviewTextVersion={revision:number;text:string};
export type ReviewEvidenceContext={id:string;label:string;status:"valid"|"recheck-required"};
export type MentorReviewContextBundle={
 object:AcademicObject;before:ReviewTextVersion|null;after:ReviewTextVersion;
 evidence:readonly ReviewEvidenceContext[];downstream:readonly AcademicPath[];
 provenance:readonly SemanticProvenanceItem[];
};
export function buildMentorReviewContext(input:MentorReviewContextBundle):MentorReviewContextBundle{
 if(input.after.revision!==input.object.revision)throw new Error("buildMentorReviewContext: after revision mismatch");
 if(input.before&&input.before.revision>=input.after.revision)throw new Error("buildMentorReviewContext: invalid before revision");
 for(const p of input.provenance)if(p.sourceEventIds.length===0)throw new Error("buildMentorReviewContext: provenance without source events");
 return structuredClone(input);
}
