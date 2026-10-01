import{evidenceStatusForClaimRevision,type EvidenceBasisLedger}from"./evidence-basis-lifecycle";
export function evidenceReadinessInput(ledger:EvidenceBasisLedger,claimId:string,claimRevision:number):{id:string;status:"VALID"|"RECHECK_REQUIRED"}[]{return ledger.links.filter(x=>x.claimId===claimId).map(x=>({id:x.linkId,status:evidenceStatusForClaimRevision(ledger,x.linkId,claimRevision)}));}
