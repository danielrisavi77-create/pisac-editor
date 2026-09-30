export type RevisionActivityRef={sessionId:string;eventIndexes:readonly number[]};
export type AcademicRevisionDraft={draftId:string;objectId:string;baseRevision:number;bindingId:string;openedAt:string;activity:readonly RevisionActivityRef[]};
export type SealedAcademicRevision={revisionId:string;objectId:string;revision:number;baseRevision:number;bindingId:string;openedAt:string;sealedAt:string;activity:readonly RevisionActivityRef[];afterText:string;evidenceIds:readonly string[]};
export type AcademicRevisionLedger={revisions:readonly SealedAcademicRevision[];drafts:readonly AcademicRevisionDraft[]};
export function currentSealedRevision(ledger:AcademicRevisionLedger,objectId:string):number{return ledger.revisions.filter(x=>x.objectId===objectId).reduce((m,x)=>Math.max(m,x.revision),0);}
function mergeActivity(a:readonly RevisionActivityRef[],b:readonly RevisionActivityRef[]):RevisionActivityRef[]{const m=new Map<string,Set<number>>();for(const x of [...a,...b]){const s=m.get(x.sessionId)??new Set<number>();for(const i of x.eventIndexes){if(!Number.isSafeInteger(i)||i<0)throw new Error("academic-revision: invalid event");s.add(i);}m.set(x.sessionId,s);}return[...m].map(([sessionId,set])=>({sessionId,eventIndexes:[...set].sort((x,y)=>x-y)}));}
export function beginAcademicRevisionDraft(ledger:AcademicRevisionLedger,input:AcademicRevisionDraft):AcademicRevisionLedger{
 if(!input.draftId||!input.objectId||!input.bindingId||!Number.isSafeInteger(input.baseRevision)||input.baseRevision<1||!Number.isFinite(Date.parse(input.openedAt)))throw new Error("academic-revision: invalid draft");
 const sealed=currentSealedRevision(ledger,input.objectId);if(sealed&&input.baseRevision!==sealed)throw new Error("academic-revision: stale base");
 const existing=ledger.drafts.find(x=>x.objectId===input.objectId);if(existing){if(existing.baseRevision!==input.baseRevision||existing.bindingId!==input.bindingId)throw new Error("academic-revision: conflicting draft");const merged={...existing,activity:mergeActivity(existing.activity,input.activity)};return{...ledger,drafts:ledger.drafts.map(x=>x.draftId===existing.draftId?merged:x)};}
 if(ledger.drafts.some(x=>x.draftId===input.draftId))throw new Error("academic-revision: duplicate draft id");return{...ledger,drafts:[...ledger.drafts,{...input,activity:mergeActivity([],input.activity)}]};
}
export function sealAcademicRevisionDraft(ledger:AcademicRevisionLedger,input:{draftId:string;revisionId:string;sealedAt:string;afterText:string;evidenceIds:readonly string[]}):AcademicRevisionLedger{
 const draft=ledger.drafts.find(x=>x.draftId===input.draftId);if(!draft)throw new Error("academic-revision: missing draft");if(!input.revisionId||ledger.revisions.some(x=>x.revisionId===input.revisionId))throw new Error("academic-revision: duplicate revision id");if(!Number.isFinite(Date.parse(input.sealedAt))||Date.parse(input.sealedAt)<Date.parse(draft.openedAt))throw new Error("academic-revision: invalid seal time");if(!draft.activity.some(x=>x.eventIndexes.length))throw new Error("academic-revision: no activity");if(new Set(input.evidenceIds).size!==input.evidenceIds.length)throw new Error("academic-revision: duplicate evidence");
 const latest=currentSealedRevision(ledger,draft.objectId);if(latest&&latest!==draft.baseRevision)throw new Error("academic-revision: stale base");
 const revision:SealedAcademicRevision={revisionId:input.revisionId,objectId:draft.objectId,revision:draft.baseRevision+1,baseRevision:draft.baseRevision,bindingId:draft.bindingId,openedAt:draft.openedAt,sealedAt:input.sealedAt,activity:draft.activity,afterText:input.afterText,evidenceIds:[...input.evidenceIds]};
 return{revisions:[...ledger.revisions,revision],drafts:ledger.drafts.filter(x=>x.draftId!==draft.draftId)};
}

export function validateAcademicRevisionLedger(ledger:AcademicRevisionLedger):boolean{
 try{
  const revisionIds=new Set<string>(),draftIds=new Set<string>();
  for(const r of ledger.revisions){if(revisionIds.has(r.revisionId)||!r.revisionId||!r.objectId||!r.bindingId||r.revision!==r.baseRevision+1||!Number.isFinite(Date.parse(r.openedAt))||!Number.isFinite(Date.parse(r.sealedAt))||Date.parse(r.sealedAt)<Date.parse(r.openedAt)||!r.activity.some(x=>x.eventIndexes.length)||new Set(r.evidenceIds).size!==r.evidenceIds.length)return false;revisionIds.add(r.revisionId);mergeActivity([],r.activity);}
  const byObject=new Map<string,SealedAcademicRevision[]>();for(const r of ledger.revisions){const xs=byObject.get(r.objectId)??[];xs.push(r);byObject.set(r.objectId,xs);}for(const xs of byObject.values()){xs.sort((a,b)=>a.revision-b.revision);for(let i=1;i<xs.length;i++)if(xs[i].baseRevision!==xs[i-1].revision)return false;}
  for(const d of ledger.drafts){if(draftIds.has(d.draftId)||revisionIds.has(d.draftId)||!d.draftId||!d.objectId||!d.bindingId||!Number.isFinite(Date.parse(d.openedAt)))return false;draftIds.add(d.draftId);mergeActivity([],d.activity);const latest=currentSealedRevision(ledger,d.objectId);if(latest&&d.baseRevision!==latest)return false;}
  return new Set(ledger.drafts.map(x=>x.objectId)).size===ledger.drafts.length;
 }catch{return false;}
}
