export type RevisionActivityRef={sessionId:string;eventIndexes:readonly number[]};
export type AcademicRevisionDraft={draftId:string;documentId:string;objectId:string;baseRevision:number;bindingId:string;openedAt:string;lastActivityAt:string;activity:readonly RevisionActivityRef[];afterText:string|null};
export type SealedAcademicRevision={revisionId:string;documentId:string;objectId:string;revision:number;baseRevision:number;bindingId:string;openedAt:string;lastActivityAt:string;sealedAt:string;activity:readonly RevisionActivityRef[];afterText:string|null};
export type AcademicRevisionLedger={revisions:readonly SealedAcademicRevision[];drafts:readonly AcademicRevisionDraft[]};

const key=(documentId:string,objectId:string)=>documentId+"\u0000"+objectId;
export function currentSealedRevision(ledger:AcademicRevisionLedger,documentId:string,objectId:string):number{
 return ledger.revisions.filter(x=>x.documentId===documentId&&x.objectId===objectId).reduce((m,x)=>Math.max(m,x.revision),0);
}
function mergeActivity(a:readonly RevisionActivityRef[],b:readonly RevisionActivityRef[]):RevisionActivityRef[]{
 const order:string[]=[];const map=new Map<string,Set<number>>();
 for(const x of [...a,...b]){
  if(!x.sessionId)throw new Error("academic-revision: invalid session");
  let set=map.get(x.sessionId);if(!set){set=new Set<number>();map.set(x.sessionId,set);order.push(x.sessionId);}
  for(const i of x.eventIndexes){if(!Number.isSafeInteger(i)||i<0)throw new Error("academic-revision: invalid event");set.add(i);}
 }
 return order.map(sessionId=>({sessionId,eventIndexes:[...map.get(sessionId)!].sort((x,y)=>x-y)}));
}
function activityContains(container:readonly RevisionActivityRef[],required:readonly RevisionActivityRef[]):boolean{
 const map=new Map(container.map(x=>[x.sessionId,new Set(x.eventIndexes)]));
 return required.every(x=>x.eventIndexes.every(i=>map.get(x.sessionId)?.has(i)));
}
function validText(x:string|null):boolean{return x===null||typeof x==="string";}

export function beginAcademicRevisionDraft(ledger:AcademicRevisionLedger,input:AcademicRevisionDraft):AcademicRevisionLedger{
 if(!input.draftId||!input.documentId||!input.objectId||!input.bindingId||!Number.isSafeInteger(input.baseRevision)||input.baseRevision<1||!Number.isFinite(Date.parse(input.openedAt))||!Number.isFinite(Date.parse(input.lastActivityAt))||Date.parse(input.lastActivityAt)<Date.parse(input.openedAt)||!validText(input.afterText)||!input.activity.some(x=>x.eventIndexes.length))throw new Error("academic-revision: invalid draft");
 const normalized={...input,activity:mergeActivity([],input.activity)};
 const sealed=currentSealedRevision(ledger,input.documentId,input.objectId);if(sealed&&input.baseRevision!==sealed)throw new Error("academic-revision: stale base");
 const existing=ledger.drafts.find(x=>x.documentId===input.documentId&&x.objectId===input.objectId);
 if(existing){
  if(existing.baseRevision!==input.baseRevision||existing.bindingId!==input.bindingId||existing.openedAt!==input.openedAt)throw new Error("academic-revision: conflicting draft");
  if(!activityContains(normalized.activity,existing.activity))throw new Error("academic-revision: stale activity");
  const merged=mergeActivity(existing.activity,normalized.activity);
  if(activityContains(existing.activity,normalized.activity)&&existing.afterText!==normalized.afterText)throw new Error("academic-revision: conflicting snapshot");
  const next={...existing,lastActivityAt:normalized.lastActivityAt,activity:merged,afterText:normalized.afterText};
  return{...ledger,drafts:ledger.drafts.map(x=>x.draftId===existing.draftId?next:x)};
 }
 if(ledger.drafts.some(x=>x.draftId===input.draftId)||ledger.revisions.some(x=>x.revisionId===input.draftId))throw new Error("academic-revision: duplicate draft id");
 return{...ledger,drafts:[...ledger.drafts,normalized]};
}

export function sealAcademicRevisionDraft(ledger:AcademicRevisionLedger,input:{draftId:string;revisionId:string;sealedAt:string}):AcademicRevisionLedger{
 const draft=ledger.drafts.find(x=>x.draftId===input.draftId);if(!draft)throw new Error("academic-revision: missing draft");
 if(!input.revisionId||ledger.revisions.some(x=>x.revisionId===input.revisionId)||ledger.drafts.some(x=>x.draftId===input.revisionId))throw new Error("academic-revision: duplicate revision id");
 if(!Number.isFinite(Date.parse(input.sealedAt))||Date.parse(input.sealedAt)<Date.parse(draft.lastActivityAt))throw new Error("academic-revision: invalid seal time");
 const latest=currentSealedRevision(ledger,draft.documentId,draft.objectId);if(latest&&latest!==draft.baseRevision)throw new Error("academic-revision: stale base");
 const revision:SealedAcademicRevision={revisionId:input.revisionId,documentId:draft.documentId,objectId:draft.objectId,revision:draft.baseRevision+1,baseRevision:draft.baseRevision,bindingId:draft.bindingId,openedAt:draft.openedAt,lastActivityAt:draft.lastActivityAt,sealedAt:input.sealedAt,activity:draft.activity,afterText:draft.afterText};
 return{revisions:[...ledger.revisions,revision],drafts:ledger.drafts.filter(x=>x.draftId!==draft.draftId)};
}

export function validateAcademicRevisionLedger(ledger:AcademicRevisionLedger):boolean{
 try{
  const revisionIds=new Set<string>(),draftIds=new Set<string>(),byObject=new Map<string,SealedAcademicRevision[]>();
  for(const r of ledger.revisions){
   if(revisionIds.has(r.revisionId)||!r.revisionId||!r.documentId||!r.objectId||!r.bindingId||r.revision!==r.baseRevision+1||r.baseRevision<1||!Number.isFinite(Date.parse(r.openedAt))||!Number.isFinite(Date.parse(r.lastActivityAt))||Date.parse(r.lastActivityAt)<Date.parse(r.openedAt)||!Number.isFinite(Date.parse(r.sealedAt))||Date.parse(r.sealedAt)<Date.parse(r.lastActivityAt)||!r.activity.some(x=>x.eventIndexes.length)||!validText(r.afterText))return false;
   revisionIds.add(r.revisionId);mergeActivity([],r.activity);const k=key(r.documentId,r.objectId),xs=byObject.get(k)??[];xs.push(r);byObject.set(k,xs);
  }
  for(const xs of byObject.values()){xs.sort((a,b)=>a.revision-b.revision);for(let i=1;i<xs.length;i++)if(xs[i].baseRevision!==xs[i-1].revision||Date.parse(xs[i].openedAt)<=Date.parse(xs[i-1].sealedAt))return false;}
  const draftKeys=new Set<string>();
  for(const d of ledger.drafts){
   const k=key(d.documentId,d.objectId);
   if(draftIds.has(d.draftId)||revisionIds.has(d.draftId)||draftKeys.has(k)||!d.draftId||!d.documentId||!d.objectId||!d.bindingId||d.baseRevision<1||!Number.isFinite(Date.parse(d.openedAt))||!Number.isFinite(Date.parse(d.lastActivityAt))||Date.parse(d.lastActivityAt)<Date.parse(d.openedAt)||!d.activity.some(x=>x.eventIndexes.length)||!validText(d.afterText))return false;
   draftIds.add(d.draftId);draftKeys.add(k);mergeActivity([],d.activity);const latest=currentSealedRevision(ledger,d.documentId,d.objectId);if(latest&&d.baseRevision!==latest)return false;
  }
  return true;
 }catch{return false;}
}
