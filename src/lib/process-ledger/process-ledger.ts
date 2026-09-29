import Dexie,{type Table}from"dexie";
import type{CapturedProcess}from"@/editor/process-capture";
export const PROCESS_LEDGER_DB_NAME="pisac-process-ledger";
export type ProcessSegmentStatus="active"|"interrupted"|"sealed";
export type ProcessSegmentRecord={documentId:string;sessionId:string;status:ProcessSegmentStatus;startedAt:string;updatedAt:string;previousSessionHead:string|null;bundle:CapturedProcess};
export class ProcessLedgerDatabase extends Dexie{segments!:Table<ProcessSegmentRecord,[string,string]>;constructor(name:string=PROCESS_LEDGER_DB_NAME){super(name);this.version(1).stores({segments:"[documentId+sessionId], documentId, status, updatedAt"});}}
export type ProcessLedgerOpenResult={ok:true;db:ProcessLedgerDatabase}|{ok:false;reason:"unavailable"|"open-failed"};
const validDate=(x:string)=>Number.isFinite(Date.parse(x));
function structurallyValid(r:ProcessSegmentRecord):boolean{
 const b=r.bundle;
 return !!r.documentId&&!!r.sessionId&&r.documentId===b?.documentId&&r.sessionId===b?.sessionId&&["active","interrupted","sealed"].includes(r.status)&&validDate(r.startedAt)&&validDate(r.updatedAt)&&Date.parse(r.updatedAt)>=Date.parse(r.startedAt)&&b?.format==="pisac-local-transactions-v1"&&b?.schema==="pisac-f1-pm-v1"&&Array.isArray(b.events)&&typeof b.genesisHash==="string"&&typeof b.receipt?.headHash==="string"&&b.receipt.eventCount===b.events.length;
}
export async function openProcessLedger(name:string=PROCESS_LEDGER_DB_NAME):Promise<ProcessLedgerOpenResult>{
 try{if(typeof indexedDB==="undefined"||indexedDB===null)return{ok:false,reason:"unavailable"};const db=new ProcessLedgerDatabase(name);await db.open();return{ok:true,db};}catch{return{ok:false,reason:"open-failed"};}
}
async function assertContinuation(db:ProcessLedgerDatabase,r:ProcessSegmentRecord){
 if(r.previousSessionHead===null)return;
 const rows=await db.segments.where("documentId").equals(r.documentId).toArray();
 const parent=rows.find(x=>x.sessionId!==r.sessionId&&x.bundle?.receipt?.headHash===r.previousSessionHead);
 if(!parent)throw new Error("process-ledger-missing-parent");
}
export async function saveProcessCheckpoint(db:ProcessLedgerDatabase,r:ProcessSegmentRecord):Promise<void>{
 if(!structurallyValid(r))throw new Error("process-ledger-invalid-record");
 await db.transaction("rw",db.segments,async()=>{const existing=await db.segments.get([r.documentId,r.sessionId]);if(existing?.status==="sealed")throw new Error("process-ledger-sealed");if(existing&&existing.startedAt!==r.startedAt)throw new Error("process-ledger-session-identity");await assertContinuation(db,r);await db.segments.put(structuredClone(r));});
}
export async function sealProcessSegment(db:ProcessLedgerDatabase,documentId:string,sessionId:string,bundle:CapturedProcess,sealedAt:string):Promise<void>{
 if(!validDate(sealedAt)||bundle.documentId!==documentId||bundle.sessionId!==sessionId)throw new Error("process-ledger-invalid-seal");
 await db.transaction("rw",db.segments,async()=>{const existing=await db.segments.get([documentId,sessionId]);if(!existing)throw new Error("process-ledger-missing-segment");if(existing.status==="sealed"){if(existing.bundle.receipt.headHash!==bundle.receipt.headHash)throw new Error("process-ledger-sealed");return;}const next:ProcessSegmentRecord={...existing,status:"sealed",updatedAt:sealedAt,bundle:structuredClone(bundle)};if(!structurallyValid(next))throw new Error("process-ledger-invalid-record");await db.segments.put(next);});
}
export async function markProcessInterrupted(db:ProcessLedgerDatabase,documentId:string,sessionId:string,at:string):Promise<void>{
 if(!validDate(at))throw new Error("process-ledger-invalid-time");
 await db.transaction("rw",db.segments,async()=>{const r=await db.segments.get([documentId,sessionId]);if(!r)throw new Error("process-ledger-missing-segment");if(r.status==="sealed")return;await db.segments.put({...r,status:"interrupted",updatedAt:at});});
}
export async function loadProcessLedger(db:ProcessLedgerDatabase,documentId:string):Promise<{segments:ProcessSegmentRecord[];invalidSessionIds:string[]}>{
 const rows=await db.segments.where("documentId").equals(documentId).toArray();const segments:ProcessSegmentRecord[]=[],invalidSessionIds:string[]=[];
 for(const r of rows){if(structurallyValid(r))segments.push(structuredClone(r));else invalidSessionIds.push(r.sessionId);}
 segments.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.sessionId.localeCompare(b.sessionId));invalidSessionIds.sort();return{segments,invalidSessionIds};
}
