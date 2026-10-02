import Dexie,{type Table}from"dexie";import{beginAcademicRevisionDraft,sealAcademicRevisionDraft,validateAcademicRevisionLedger,type AcademicRevisionDraft,type AcademicRevisionLedger,type SealedAcademicRevision}from"@/domain/academic-graph/academic-revision-lifecycle";
export const ACADEMIC_REVISION_DB_NAME="pisac-academic-revisions";
export class AcademicRevisionDatabase extends Dexie{
 drafts!:Table<AcademicRevisionDraft,string>;revisions!:Table<SealedAcademicRevision,string>;
 constructor(name=ACADEMIC_REVISION_DB_NAME){super(name);this.version(1).stores({drafts:"draftId, &[documentId+objectId], bindingId",revisions:"revisionId, &[documentId+objectId+revision], bindingId, sealedAt"});}
}
export async function openAcademicRevisionStore(name=ACADEMIC_REVISION_DB_NAME):Promise<{ok:true;db:AcademicRevisionDatabase}|{ok:false;reason:"unavailable"|"open-failed"}>{try{if(typeof indexedDB==="undefined"||indexedDB===null)return{ok:false,reason:"unavailable"};const db=new AcademicRevisionDatabase(name);await db.open();return{ok:true,db};}catch{return{ok:false,reason:"open-failed"};}}
export async function loadAcademicRevisionLedger(db:AcademicRevisionDatabase):Promise<{ok:true;ledger:AcademicRevisionLedger}|{ok:false;reason:"invalid-ledger"}>{
 try{const ledger:AcademicRevisionLedger={drafts:await db.drafts.toArray(),revisions:await db.revisions.toArray()};return validateAcademicRevisionLedger(ledger)?{ok:true,ledger}:{ok:false,reason:"invalid-ledger"};}catch{return{ok:false,reason:"invalid-ledger"};}
}
export async function persistAcademicRevisionDraft(db:AcademicRevisionDatabase,draft:AcademicRevisionDraft):Promise<AcademicRevisionLedger>{
 return db.transaction("rw",db.drafts,db.revisions,async()=>{const loaded=await loadAcademicRevisionLedger(db);if(!loaded.ok)throw new Error("academic-revision-db: invalid-ledger");const next=beginAcademicRevisionDraft(loaded.ledger,draft);const saved=next.drafts.find(x=>x.documentId===draft.documentId&&x.objectId===draft.objectId)!;await db.drafts.put(structuredClone(saved));return next;});
}
export async function sealPersistedAcademicRevision(db:AcademicRevisionDatabase,input:{draftId:string;revisionId:string;sealedAt:string}):Promise<{ledger:AcademicRevisionLedger;revision:SealedAcademicRevision}>{
 return db.transaction("rw",db.drafts,db.revisions,async()=>{const loaded=await loadAcademicRevisionLedger(db);if(!loaded.ok)throw new Error("academic-revision-db: invalid-ledger");const next=sealAcademicRevisionDraft(loaded.ledger,input);const revision=next.revisions.find(x=>x.revisionId===input.revisionId)!;await db.revisions.add(structuredClone(revision));await db.drafts.delete(input.draftId);return{ledger:next,revision};});
}
