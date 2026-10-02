import Dexie,{type Table}from"dexie";import{attachEvidenceReview,verifyEvidenceReviewForRevision,type EvidenceReviewLedger,type EvidenceReviewLink,type EvidenceReviewVerification}from"@/domain/academic-graph/evidence-basis-lifecycle";
export const EVIDENCE_BASIS_DB_NAME="pisac-evidence-basis";
type LegacyRow={id:string;kind:string;payload?:unknown};
export class EvidenceReviewDatabase extends Dexie{
 rows!:Table<LegacyRow,string>;links!:Table<EvidenceReviewLink,[string,string]>;verifications!:Table<EvidenceReviewVerification,[string,string]>;
 constructor(name=EVIDENCE_BASIS_DB_NAME){super(name);this.version(1).stores({rows:"id, kind"});this.version(2).stores({rows:"id, kind",links:"&[documentId+linkId], [documentId+claimId], sourceId, attachedAt",verifications:"&[documentId+verificationId], &[documentId+linkId+claimRevision], [documentId+linkId], basisId, verifiedAt"});}
}
export async function openEvidenceBasisStore(name=EVIDENCE_BASIS_DB_NAME):Promise<{ok:true;db:EvidenceReviewDatabase}|{ok:false;reason:"unavailable"|"open-failed"}>{try{if(typeof indexedDB==="undefined"||indexedDB===null)return{ok:false,reason:"unavailable"};const db=new EvidenceReviewDatabase(name);await db.open();return{ok:true,db};}catch{return{ok:false,reason:"open-failed"};}}
export async function loadEvidenceReviewLedger(db:EvidenceReviewDatabase):Promise<{ok:true;ledger:EvidenceReviewLedger}|{ok:false;reason:"invalid-ledger"}>{
 try{
  if(await db.rows.count())return{ok:false,reason:"invalid-ledger"};
  const links=(await db.links.toArray()).sort((a,b)=>a.documentId.localeCompare(b.documentId)||a.claimId.localeCompare(b.claimId)||a.attachedRevision-b.attachedRevision||Date.parse(a.attachedAt)-Date.parse(b.attachedAt)||a.linkId.localeCompare(b.linkId));
  const verifications=(await db.verifications.toArray()).sort((a,b)=>a.documentId.localeCompare(b.documentId)||a.linkId.localeCompare(b.linkId)||a.claimRevision-b.claimRevision||Date.parse(a.verifiedAt)-Date.parse(b.verifiedAt)||a.verificationId.localeCompare(b.verificationId));
  let ledger:EvidenceReviewLedger={links:[],verifications:[]};for(const link of links)ledger=attachEvidenceReview(ledger,link);for(const v of verifications)ledger=verifyEvidenceReviewForRevision(ledger,v);return{ok:true,ledger};
 }catch{return{ok:false,reason:"invalid-ledger"};}
}
export async function appendEvidenceReviewLink(db:EvidenceReviewDatabase,link:EvidenceReviewLink):Promise<EvidenceReviewLedger>{
 return db.transaction("rw",db.rows,db.links,db.verifications,async()=>{const loaded=await loadEvidenceReviewLedger(db);if(!loaded.ok)throw new Error("evidence-review-db: invalid-ledger");const next=attachEvidenceReview(loaded.ledger,link);await db.links.add(structuredClone(link));return next;});
}
export async function appendEvidenceReviewVerification(db:EvidenceReviewDatabase,v:EvidenceReviewVerification):Promise<EvidenceReviewLedger>{
 return db.transaction("rw",db.rows,db.links,db.verifications,async()=>{const loaded=await loadEvidenceReviewLedger(db);if(!loaded.ok)throw new Error("evidence-review-db: invalid-ledger");const next=verifyEvidenceReviewForRevision(loaded.ledger,v);await db.verifications.add(structuredClone(v));return next;});
}
