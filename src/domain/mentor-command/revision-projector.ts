import type{AcademicObjectNodeBinding}from"@/domain/academic-graph/academic-object-registry";
import type{SealedAcademicRevision}from"@/domain/academic-graph/academic-revision-lifecycle";
import type{CoverageItem,ReviewDeltaItem}from"@/domain/mentor-review";
import{isRevisionReviewCoverageRecord,legacyCoverageRecord,type RevisionReviewCoverageRecord}from"@/domain/mentor-review/revision-coverage";
import{evaluateAcademicReadiness}from"@/domain/readiness";
import{buildMentorQueue,type MentorProjectInput}from"./command-center";

export type RevisionProjectorInput={projectId:string;studentId:string;studentLabel:string;workLabel:string;reviewerId:string;documentId:string;objectLabel:string;binding:AcademicObjectNodeBinding;revisions:readonly SealedAcademicRevision[];reviews:readonly RevisionReviewCoverageRecord[];evidence:readonly{id:string;status:"VALID"|"RECHECK_REQUIRED"}[];evidenceRecheckOwner:"mentor"|"student";studentResponseCount?:number;forensicAnomalyCount?:number;finalReviewRequested?:boolean};

export function projectRevisionMentorState(input:RevisionProjectorInput){
 if(input.binding.documentId!==input.documentId)throw new Error("mentor-projection: binding document mismatch");
 if(input.reviews.some(x=>!isRevisionReviewCoverageRecord(x)))throw new Error("mentor-projection: invalid review");

 const relevantRevisions=input.revisions.filter(x=>x.documentId===input.documentId&&x.objectId===input.binding.objectId).sort((a,b)=>a.revision-b.revision);
 const latestRevision=relevantRevisions.at(-1)??null;
 if(latestRevision&&latestRevision.revision>input.binding.objectRevision)throw new Error("mentor-projection: registry behind revision");

 const reviews=input.reviews.filter(x=>x.documentId===input.documentId&&x.reviewerId===input.reviewerId&&x.objectId===input.binding.objectId);
 if(new Set(reviews.map(x=>x.id)).size!==reviews.length)throw new Error("mentor-projection: duplicate review id");
 if(reviews.some(x=>x.reviewedRevision>input.binding.objectRevision))throw new Error("mentor-projection: future review");
 const chronology=new Map<string,Set<number>>();for(const review of reviews){const times=chronology.get(review.bindingId)??new Set<number>();const at=Date.parse(review.reviewedAt);if(times.has(at))throw new Error("mentor-projection: ambiguous review order");times.add(at);chronology.set(review.bindingId,times);}
 const currentBindingReviews=reviews.filter(x=>x.bindingId===input.binding.bindingId);
 if(currentBindingReviews.some(x=>x.reviewedRevision!==input.binding.objectRevision))throw new Error("mentor-projection: binding revision mismatch");

 const object={id:input.binding.objectId,type:input.binding.objectType,label:input.objectLabel,revision:input.binding.objectRevision};
 const byNewest=(a:RevisionReviewCoverageRecord,b:RevisionReviewCoverageRecord)=>Date.parse(b.reviewedAt)-Date.parse(a.reviewedAt)||b.id.localeCompare(a.id);
 const latestCurrent=[...currentBindingReviews].sort(byNewest)[0]??null;
 const latestAny=[...reviews].sort(byNewest)[0]??null;
 const state=latestCurrent?"CURRENTLY_COVERED":latestAny?"CHANGED_SINCE_REVIEW":"NEVER_REVIEWED";
 const coverage:CoverageItem[]=[{object,state,lastReview:(latestCurrent??latestAny)?legacyCoverageRecord((latestCurrent??latestAny)!):null}];

 const changeKinds=new Set<"content"|"structure">();
 if(latestRevision?.revision===input.binding.objectRevision)changeKinds.add("content");
 if(latestAny&&latestAny.bindingId!==input.binding.bindingId)changeKinds.add("structure");
 const delta:ReviewDeltaItem[]=state==="CURRENTLY_COVERED"?[]:[{object,kind:state==="NEVER_REVIEWED"?"new":"changed",lastReviewedRevision:latestAny?.reviewedRevision??null,currentRevision:object.revision,changeKinds:[...changeKinds]}];

 const readiness=evaluateAcademicReadiness({graphIssues:[],coverage,evidence:input.evidence,protectedFacts:[],analysis:[],instructionIssues:[],lekta:{status:"clean",findingCount:0}});
 const blockers=readiness.findings.filter(x=>x.severity==="blocker");
 const studentReadinessBlockers=blockers.filter(x=>x.area==="evidence"&&input.evidenceRecheckOwner==="student");
 const mentorReadinessBlockers=blockers.filter(x=>!(x.area==="evidence"&&input.evidenceRecheckOwner==="student"));

 const changedDeltaCount=delta.filter(x=>x.kind==="changed").length;
 const neverReviewedCount=coverage.filter(x=>x.state==="NEVER_REVIEWED").length;
 const revisionRequestPending=latestCurrent?.status==="needs-work";
 const lastActivityAt=new Date(Math.max(Date.parse(input.binding.boundAt),latestRevision?Date.parse(latestRevision.sealedAt):-Infinity)).toISOString();

 const projected:MentorProjectInput={projectId:input.projectId,studentId:input.studentId,studentLabel:input.studentLabel,workLabel:input.workLabel,lastActivityAt,reviewDeltaCount:changedDeltaCount,studentResponseCount:input.studentResponseCount??0,neverReviewedCount,readinessBlockerCount:mentorReadinessBlockers.length,forensicAnomalyCount:input.forensicAnomalyCount??0,finalReviewRequested:input.finalReviewRequested??false,studentWorkPending:revisionRequestPending||studentReadinessBlockers.length>0};
 const queue=buildMentorQueue([projected])[0];

 return{input:projected,queue,coverage,delta,readiness,actionState:{mentor:{changedReviewCount:changedDeltaCount,neverReviewedCount,readinessBlockerCount:mentorReadinessBlockers.length},student:{readinessBlockerCount:studentReadinessBlockers.length,revisionRequestPending},waitingOn:queue.waitingOn}};
}
