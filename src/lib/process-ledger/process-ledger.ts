import Dexie,{type Table}from"dexie";
import type{CapturedProcess}from"@/editor/process-capture";
import{canonicalize}from"@/domain/forensics/integrity";
export const PROCESS_LEDGER_DB_NAME="pisac-process-ledger";
export type ProcessSegmentStatus="active"|"interrupted"|"sealed";
export type ProcessSegmentRecord={documentId:string;sessionId:string;status:ProcessSegmentStatus;startedAt:string;updatedAt:string;previousSessionHead:string|null;bundle:CapturedProcess};
export type ProcessCheckpointInput=Omit<ProcessSegmentRecord,"documentId"|"sessionId"|"status">&{status:"active"};
export class ProcessLedgerDatabase extends Dexie{segments!:Table<ProcessSegmentRecord,[string,string]>;constructor(name:string=PROCESS_LEDGER_DB_NAME){super(name);this.version(1).stores({segments:"[documentId+sessionId], documentId, status, updatedAt"});}}
export type ProcessLedgerOpenResult={ok:true;db:ProcessLedgerDatabase}|{ok:false;reason:"unavailable"|"open-failed"};
const validDate=(x:string)=>Number.isFinite(Date.parse(x));
function structurallyValid(r:ProcessSegmentRecord):boolean{
 const b=r.bundle;
 if(!(!!r.documentId&&!!r.sessionId&&r.documentId===b?.documentId&&r.sessionId===b?.sessionId&&["active","interrupted","sealed"].includes(r.status)&&validDate(r.startedAt)&&validDate(r.updatedAt)&&Date.parse(r.updatedAt)>=Date.parse(r.startedAt)&&b?.format==="pisac-local-transactions-v1"&&b?.schema==="pisac-f1-pm-v1"&&Array.isArray(b.events)&&typeof b.genesisHash==="string"&&typeof b.receipt?.headHash==="string"&&b.receipt.eventCount===b.events.length))return false;
 let previous=b.genesisHash;
 for(let i=0;i<b.events.length;i++){const entry=b.events[i];if(entry.event.sequence!==i+1||entry.event.documentId!==b.documentId||entry.event.sessionId!==b.sessionId||entry.previousHash!==previous)return false;previous=entry.eventHash;}
 return b.receipt.headHash===previous;
}
export async function openProcessLedger(name:string=PROCESS_LEDGER_DB_NAME):Promise<ProcessLedgerOpenResult>{
 try{if(typeof indexedDB==="undefined"||indexedDB===null)return{ok:false,reason:"unavailable"};const db=new ProcessLedgerDatabase(name);await db.open();return{ok:true,db};}catch{return{ok:false,reason:"open-failed"};}
}
function canonicalEqual(a:unknown,b:unknown):boolean{try{return canonicalize(a)===canonicalize(b);}catch{return false;}}
function extendsPersistedPrefix(previous:CapturedProcess,next:CapturedProcess):boolean{
 if(previous.documentId!==next.documentId||previous.sessionId!==next.sessionId||previous.genesisHash!==next.genesisHash||!canonicalEqual(previous.initialDocument,next.initialDocument)||next.events.length<previous.events.length)return false;
 for(let i=0;i<previous.events.length;i++)if(!canonicalEqual(previous.events[i],next.events[i]))return false;
 const expectedHead=previous.events.length?next.events[previous.events.length-1]?.eventHash:next.genesisHash;
 return previous.receipt.headHash===expectedHead;
}
function chainOrder(rows:readonly ProcessSegmentRecord[]):ProcessSegmentRecord[]|null{
 if(!rows.length)return[];
 const byHead=new Map<string,ProcessSegmentRecord>();
 for(const row of rows){if(byHead.has(row.bundle.receipt.headHash))return null;byHead.set(row.bundle.receipt.headHash,row);}
 const roots=rows.filter(x=>x.previousSessionHead===null);if(roots.length!==1)return null;
 const childByParent=new Map<string,ProcessSegmentRecord>();
 for(const row of rows){
  if(row.previousSessionHead===null)continue;
  const parent=byHead.get(row.previousSessionHead);if(!parent||parent.sessionId===row.sessionId||childByParent.has(row.previousSessionHead))return null;
  if(parent.status==="active"||Date.parse(row.startedAt)<Date.parse(parent.updatedAt))return null;
  childByParent.set(row.previousSessionHead,row);
 }
 const ordered:ProcessSegmentRecord[]=[];const seen=new Set<string>();let current:ProcessSegmentRecord|undefined=roots[0];
 while(current){if(seen.has(current.sessionId))return null;seen.add(current.sessionId);ordered.push(current);current=childByParent.get(current.bundle.receipt.headHash);}
 return ordered.length===rows.length?ordered:null;
}
async function assertContinuation(db:ProcessLedgerDatabase,r:ProcessSegmentRecord){
 const rows=(await db.segments.where("documentId").equals(r.documentId).toArray()).filter(x=>x.sessionId!==r.sessionId);
 if(rows.some(x=>!structurallyValid(x)))throw new Error("process-ledger-invalid-record");
 const ordered=chainOrder(rows);if(!ordered)throw new Error("process-ledger-chain-invalid");
 const latest=ordered.at(-1);
 if(!latest){if(r.previousSessionHead!==null)throw new Error("process-ledger-missing-parent");return;}
 if(latest.status==="active")throw new Error("process-ledger-parent-active");
 if(Date.parse(r.startedAt)<Date.parse(latest.updatedAt))throw new Error("process-ledger-overlap");
 if(r.previousSessionHead!==latest.bundle.receipt.headHash)throw new Error("process-ledger-missing-parent");
}
export async function saveProcessCheckpoint(db:ProcessLedgerDatabase,input:ProcessCheckpointInput):Promise<void>{
 const r:ProcessSegmentRecord={...input,documentId:input.bundle.documentId,sessionId:input.bundle.sessionId};
 if(r.status!=="active"||!structurallyValid(r))throw new Error("process-ledger-invalid-record");
 await db.transaction("rw",db.segments,async()=>{
  const existing=await db.segments.get([r.documentId,r.sessionId]);
  if(existing?.status==="sealed")throw new Error("process-ledger-sealed");
  if(existing?.status==="interrupted")throw new Error("process-ledger-interrupted");
  if(existing&&existing.startedAt!==r.startedAt)throw new Error("process-ledger-session-identity");
  if(existing&&existing.previousSessionHead!==r.previousSessionHead)throw new Error("process-ledger-session-identity");
  if(existing&&Date.parse(r.updatedAt)<Date.parse(existing.updatedAt))throw new Error("process-ledger-time-rollback");
  if(existing&&!extendsPersistedPrefix(existing.bundle,r.bundle))throw new Error("process-ledger-non-append");
  await assertContinuation(db,r);await db.segments.put(structuredClone(r));
 });
}
export async function sealProcessSegment(db:ProcessLedgerDatabase,documentId:string,sessionId:string,bundle:CapturedProcess,sealedAt:string):Promise<void>{
 if(!validDate(sealedAt)||bundle.documentId!==documentId||bundle.sessionId!==sessionId)throw new Error("process-ledger-invalid-seal");
 await db.transaction("rw",db.segments,async()=>{
  const existing=await db.segments.get([documentId,sessionId]);
  if(!existing)throw new Error("process-ledger-missing-segment");
  if(existing.status==="sealed"){if(!canonicalEqual(existing.bundle,bundle))throw new Error("process-ledger-sealed");return;}
  if(existing.status==="interrupted")throw new Error("process-ledger-interrupted");
  if(Date.parse(sealedAt)<Date.parse(existing.updatedAt))throw new Error("process-ledger-invalid-seal");
  if(!extendsPersistedPrefix(existing.bundle,bundle))throw new Error("process-ledger-non-append");
  const next:ProcessSegmentRecord={...existing,status:"sealed",updatedAt:sealedAt,bundle:structuredClone(bundle)};
  if(!structurallyValid(next))throw new Error("process-ledger-invalid-record");
  await db.segments.put(next);
 });
}
export async function markProcessInterrupted(db:ProcessLedgerDatabase,documentId:string,sessionId:string,at:string):Promise<void>{
 if(!validDate(at))throw new Error("process-ledger-invalid-time");
 await db.transaction("rw",db.segments,async()=>{
  const r=await db.segments.get([documentId,sessionId]);
  if(!r)throw new Error("process-ledger-missing-segment");
  if(r.status==="sealed"||r.status==="interrupted")return;
  if(Date.parse(at)<Date.parse(r.updatedAt))throw new Error("process-ledger-invalid-time");
  await db.segments.put({...r,status:"interrupted",updatedAt:at});
 });
}
export async function loadProcessLedger(db:ProcessLedgerDatabase,documentId:string):Promise<{segments:ProcessSegmentRecord[];invalidSessionIds:string[]}>{
 const rows=await db.segments.where("documentId").equals(documentId).toArray();let segments:ProcessSegmentRecord[]=[],invalidSessionIds:string[]=[];
 for(const r of rows){if(structurallyValid(r))segments.push(structuredClone(r));else invalidSessionIds.push(r.sessionId);}
 const ordered=chainOrder(segments);if(ordered)segments=ordered;else segments.sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.sessionId.localeCompare(b.sessionId));
 invalidSessionIds.sort();return{segments,invalidSessionIds};
}
