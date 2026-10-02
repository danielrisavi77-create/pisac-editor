import type{EvidenceEvaluation}from"@/domain/evidence";import{evidenceReviewAssessmentForClaimRevision,type EvidenceReviewLedger}from"./evidence-basis-lifecycle";
export type BasisValidityInput={basisId:string;status:"VALID"|"RECHECK_REQUIRED"};
export function basisValidityFromEvaluation(basisId:string,evaluation:EvidenceEvaluation):BasisValidityInput{if(!basisId.trim())throw new Error("evidence-readiness: basis id required");return{basisId,status:evaluation.status};}
export function evidenceReadinessInput(ledger:EvidenceReviewLedger,documentId:string,claimId:string,claimRevision:number,basisValidity:readonly BasisValidityInput[]):{id:string;status:"VALID"|"RECHECK_REQUIRED"}[]{
 const validity=new Map<string,"VALID"|"RECHECK_REQUIRED">();
 for(const x of basisValidity){
  if(!x.basisId.trim()||!["VALID","RECHECK_REQUIRED"].includes(x.status))throw new Error("evidence-readiness: invalid basis validity");
  const prior=validity.get(x.basisId);validity.set(x.basisId,prior&&prior!==x.status?"RECHECK_REQUIRED":x.status);
 }
 return ledger.links.filter(x=>x.documentId===documentId&&x.claimId===claimId&&x.attachedRevision<=claimRevision).map(x=>{
  const assessment=evidenceReviewAssessmentForClaimRevision(ledger,documentId,x.linkId,claimRevision);if(!assessment)throw new Error("evidence-readiness: missing assessment");
  if(assessment.reviewStatus==="RECHECK_REQUIRED"||!assessment.basisId||validity.get(assessment.basisId)!=="VALID")return{id:x.linkId,status:"RECHECK_REQUIRED" as const};
  return{id:x.linkId,status:"VALID" as const};
 });
}
