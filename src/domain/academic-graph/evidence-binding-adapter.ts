import type{AcademicObjectNodeBinding}from"./academic-object-registry";import{attachEvidenceReview,verifyEvidenceReviewForRevision,type EvidenceReviewLedger,type EvidenceReviewLink,type EvidenceVerdict,type EvidenceReviewVerification}from"./evidence-basis-lifecycle";import{createEvidenceBasis,type EvidenceBasis}from"@/domain/evidence";
function requireClaimBinding(binding:AcademicObjectNodeBinding){if(binding.objectType!=="claim")throw new Error("evidence-binding: object is not a claim");}
export type EvidenceBasisReviewRef={basisId:string;claimId:string;sourceId:string;nodeId:string};
export function evidenceBasisReviewRef(basis:EvidenceBasis):EvidenceBasisReviewRef{
 const checked=createEvidenceBasis(basis);
 return{basisId:String(checked.id),claimId:String(checked.claim.claimId),sourceId:String(checked.source.sourceId),nodeId:String(checked.claim.target.nodeId)};
}
export function evidenceReviewLinkForCurrentBinding(binding:AcademicObjectNodeBinding,input:{linkId:string;sourceId:string;attachedAt:string}):EvidenceReviewLink{
 requireClaimBinding(binding);if(Date.parse(input.attachedAt)<Date.parse(binding.boundAt))throw new Error("evidence-binding: attachment before current revision");
 return{documentId:binding.documentId,linkId:input.linkId,claimId:binding.objectId,sourceId:input.sourceId,attachedRevision:binding.objectRevision,attachedAt:input.attachedAt};
}
export function attachEvidenceReviewToCurrentBinding(ledger:EvidenceReviewLedger,binding:AcademicObjectNodeBinding,input:{linkId:string;sourceId:string;attachedAt:string}):EvidenceReviewLedger{
 return attachEvidenceReview(ledger,evidenceReviewLinkForCurrentBinding(binding,input));
}
export function evidenceVerificationForCurrentBinding(ledger:EvidenceReviewLedger,binding:AcademicObjectNodeBinding,input:{verificationId:string;linkId:string;basis:EvidenceBasisReviewRef;verifiedAt:string;verdict:EvidenceVerdict}):EvidenceReviewVerification{
 requireClaimBinding(binding);const link=ledger.links.find(x=>x.documentId===binding.documentId&&x.linkId===input.linkId);if(!link||link.claimId!==binding.objectId)throw new Error("evidence-binding: link mismatch");
 if(!input.basis.basisId.trim()||input.basis.claimId!==binding.objectId||input.basis.sourceId!==link.sourceId||input.basis.nodeId!==binding.nodeId)throw new Error("evidence-binding: basis mismatch");
 if(Date.parse(input.verifiedAt)<Date.parse(binding.boundAt))throw new Error("evidence-binding: verification before current revision");
 return{documentId:binding.documentId,verificationId:input.verificationId,linkId:input.linkId,basisId:input.basis.basisId,claimRevision:binding.objectRevision,verifiedAt:input.verifiedAt,verdict:input.verdict};
}
export function verifyEvidenceReviewForCurrentBinding(ledger:EvidenceReviewLedger,binding:AcademicObjectNodeBinding,input:{verificationId:string;linkId:string;basis:EvidenceBasisReviewRef;verifiedAt:string;verdict:EvidenceVerdict}):EvidenceReviewLedger{
 return verifyEvidenceReviewForRevision(ledger,evidenceVerificationForCurrentBinding(ledger,binding,input));
}
