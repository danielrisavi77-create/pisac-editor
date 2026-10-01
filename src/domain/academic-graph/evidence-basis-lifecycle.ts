export type EvidenceVerdict="supports"|"challenges"|"insufficient";
export type EvidenceBasisLink={linkId:string;claimId:string;sourceId:string;attachedAt:string};
export type EvidenceVerification={verificationId:string;linkId:string;claimRevision:number;verifiedAt:string;verdict:EvidenceVerdict};
export type EvidenceBasisLedger={links:readonly EvidenceBasisLink[];verifications:readonly EvidenceVerification[]};
export function attachEvidenceBasis(ledger:EvidenceBasisLedger,link:EvidenceBasisLink):EvidenceBasisLedger{
 if(!link.linkId||!link.claimId||!link.sourceId||!Number.isFinite(Date.parse(link.attachedAt)))throw new Error("evidence-basis: invalid link");if(ledger.links.some(x=>x.linkId===link.linkId))throw new Error("evidence-basis: duplicate link");return{...ledger,links:[...ledger.links,{...link}]};
}
export function verifyEvidenceForRevision(ledger:EvidenceBasisLedger,v:EvidenceVerification):EvidenceBasisLedger{
 if(!v.verificationId||ledger.verifications.some(x=>x.verificationId===v.verificationId)||!Number.isSafeInteger(v.claimRevision)||v.claimRevision<1||!Number.isFinite(Date.parse(v.verifiedAt))||!["supports","challenges","insufficient"].includes(v.verdict))throw new Error("evidence-basis: invalid verification");const link=ledger.links.find(x=>x.linkId===v.linkId);if(!link)throw new Error("evidence-basis: missing link");if(Date.parse(v.verifiedAt)<Date.parse(link.attachedAt))throw new Error("evidence-basis: verification before attachment");return{...ledger,verifications:[...ledger.verifications,{...v}]};
}
export function evidenceAssessmentForClaimRevision(ledger:EvidenceBasisLedger,linkId:string,claimRevision:number):{reviewStatus:"VALID"|"RECHECK_REQUIRED";verdict:EvidenceVerdict|null}{
 const xs=ledger.verifications.filter(x=>x.linkId===linkId&&x.claimRevision===claimRevision).sort((a,b)=>Date.parse(a.verifiedAt)-Date.parse(b.verifiedAt));const latest=xs.at(-1);return latest?{reviewStatus:"VALID",verdict:latest.verdict}:{reviewStatus:"RECHECK_REQUIRED",verdict:null};
}
export function evidenceStatusForClaimRevision(ledger:EvidenceBasisLedger,linkId:string,claimRevision:number):"VALID"|"RECHECK_REQUIRED"{return evidenceAssessmentForClaimRevision(ledger,linkId,claimRevision).reviewStatus;}

