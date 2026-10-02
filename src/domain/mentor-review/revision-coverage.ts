import type{AcademicObjectNodeBinding}from"@/domain/academic-graph/academic-object-registry";import type{ReviewCoverageRecord}from"./coverage";
export type RevisionReviewCoverageRecord=ReviewCoverageRecord&{documentId:string;bindingId:string};
export function isRevisionReviewCoverageRecord(value:unknown):value is RevisionReviewCoverageRecord{
 if(!value||typeof value!=="object")return false;const r=value as Partial<RevisionReviewCoverageRecord>;
 return typeof r.documentId==="string"&&!!r.documentId.trim()&&typeof r.bindingId==="string"&&!!r.bindingId.trim()&&typeof r.id==="string"&&!!r.id.trim()&&typeof r.reviewerId==="string"&&!!r.reviewerId.trim()&&typeof r.objectId==="string"&&!!r.objectId.trim()&&Number.isSafeInteger(r.reviewedRevision)&&Number(r.reviewedRevision)>0&&typeof r.reviewedAt==="string"&&Number.isFinite(Date.parse(r.reviewedAt))&&(r.status==="reviewed"||r.status==="accepted"||r.status==="needs-work");
}
export function reviewCoverageForCurrentBinding(binding:AcademicObjectNodeBinding,input:{id:string;reviewerId:string;reviewedAt:string;status:ReviewCoverageRecord["status"]}):RevisionReviewCoverageRecord{
 const row:RevisionReviewCoverageRecord={documentId:binding.documentId,bindingId:binding.bindingId,id:input.id,reviewerId:input.reviewerId,objectId:binding.objectId,reviewedRevision:binding.objectRevision,reviewedAt:input.reviewedAt,status:input.status};
 if(!isRevisionReviewCoverageRecord(row)||Date.parse(input.reviewedAt)<Date.parse(binding.boundAt))throw new Error("revision-review-coverage: invalid review");
 return row;
}
export function legacyCoverageRecord(row:RevisionReviewCoverageRecord):ReviewCoverageRecord{const{documentId:_documentId,bindingId:_bindingId,...legacy}=row;return legacy;}
