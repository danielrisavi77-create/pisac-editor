export type EvidenceVerdict="supports"|"challenges"|"insufficient";
export type EvidenceReviewStatus="VALID"|"RECHECK_REQUIRED";
export type EvidenceReviewLink={documentId:string;linkId:string;claimId:string;sourceId:string;attachedRevision:number;attachedAt:string};
export type EvidenceReviewVerification={documentId:string;verificationId:string;linkId:string;basisId:string;claimRevision:number;verifiedAt:string;verdict:EvidenceVerdict};
export type EvidenceReviewLedger={links:readonly EvidenceReviewLink[];verifications:readonly EvidenceReviewVerification[]};
export type EvidenceReviewAssessment={reviewStatus:EvidenceReviewStatus;basisId:string|null;verdict:EvidenceVerdict|null};

const validDate=(x:string)=>Number.isFinite(Date.parse(x));
const validVerdict=(x:string):x is EvidenceVerdict=>["supports","challenges","insufficient"].includes(x);

export function attachEvidenceReview(ledger:EvidenceReviewLedger,link:EvidenceReviewLink):EvidenceReviewLedger{
 if(!link.documentId.trim()||!link.linkId.trim()||!link.claimId.trim()||!link.sourceId.trim()||!Number.isSafeInteger(link.attachedRevision)||link.attachedRevision<1||!validDate(link.attachedAt))throw new Error("evidence-review: invalid link");
 if(ledger.links.some(x=>x.documentId===link.documentId&&x.linkId===link.linkId))throw new Error("evidence-review: duplicate link");
 return{...ledger,links:[...ledger.links,{...link}]};
}
export function verifyEvidenceReviewForRevision(ledger:EvidenceReviewLedger,v:EvidenceReviewVerification):EvidenceReviewLedger{
 if(!v.documentId.trim()||!v.verificationId.trim()||!v.linkId.trim()||!v.basisId.trim()||!Number.isSafeInteger(v.claimRevision)||v.claimRevision<1||!validDate(v.verifiedAt)||!validVerdict(v.verdict))throw new Error("evidence-review: invalid verification");
 if(ledger.verifications.some(x=>x.documentId===v.documentId&&x.verificationId===v.verificationId))throw new Error("evidence-review: duplicate verification");
 const link=ledger.links.find(x=>x.documentId===v.documentId&&x.linkId===v.linkId);if(!link)throw new Error("evidence-review: missing link");
 if(v.claimRevision<link.attachedRevision)throw new Error("evidence-review: verification before attachment revision");
 if(Date.parse(v.verifiedAt)<Date.parse(link.attachedAt))throw new Error("evidence-review: verification before attachment");
 if(ledger.verifications.some(x=>x.documentId===v.documentId&&x.linkId===v.linkId&&x.claimRevision===v.claimRevision))throw new Error("evidence-review: revision already verified");
 return{...ledger,verifications:[...ledger.verifications,{...v}]};
}
export function evidenceReviewAssessmentForClaimRevision(ledger:EvidenceReviewLedger,documentId:string,linkId:string,claimRevision:number):EvidenceReviewAssessment|null{
 if(!Number.isSafeInteger(claimRevision)||claimRevision<1)throw new Error("evidence-review: invalid revision");
 const link=ledger.links.find(x=>x.documentId===documentId&&x.linkId===linkId);if(!link)return null;
 if(claimRevision<link.attachedRevision)return null;
 const exact=ledger.verifications.find(x=>x.documentId===documentId&&x.linkId===linkId&&x.claimRevision===claimRevision);
 return exact?{reviewStatus:"VALID",basisId:exact.basisId,verdict:exact.verdict}:{reviewStatus:"RECHECK_REQUIRED",basisId:null,verdict:null};
}
