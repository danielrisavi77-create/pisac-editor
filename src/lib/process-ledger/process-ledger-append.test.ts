import"fake-indexeddb/auto";import{afterEach,describe,expect,it}from"vitest";import Dexie from"dexie";import{openProcessLedger,saveProcessCheckpoint}from"./process-ledger";import type{CapturedProcess}from"@/editor/process-capture";
const name="pisac-process-ledger-append-test";afterEach(async()=>Dexie.delete(name));
const b=(hashes:string[]):CapturedProcess=>({format:"pisac-local-transactions-v1",schema:"pisac-f1-pm-v1",documentId:"d",sessionId:"s",initialDocument:{type:"doc",content:[{type:"paragraph"}]},genesisHash:"g",events:hashes.map((h,i)=>({event:{sequence:i+1,documentId:"d",sessionId:"s",occurredAt:"2026-09-29T20:00:00Z",elapsedMs:i,source:"editor",steps:[{stepType:"replace",from:1,to:1}],beforeHash:"b",afterHash:"a"},previousHash:i?hashes[i-1]:"g",eventHash:h})),receipt:{eventCount:hashes.length,headHash:hashes.at(-1)??"g",finalDocumentHash:"f"}});
describe("append-only durable checkpoints",()=>{
 it("rejects rollback, changed hashes and same-hash rewrites of a persisted prefix",async()=>{
  const o=await openProcessLedger(name);if(!o.ok)throw new Error("open");const meta={status:"active"as const,startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:01:00Z",previousSessionHead:null};
  await saveProcessCheckpoint(o.db,{...meta,bundle:b(["h1","h2"])});
  await expect(saveProcessCheckpoint(o.db,{...meta,updatedAt:"2026-09-29T20:02:00Z",bundle:b(["h1"])})).rejects.toThrow("non-append");
  await expect(saveProcessCheckpoint(o.db,{...meta,updatedAt:"2026-09-29T20:03:00Z",bundle:b(["X","h2","h3"])})).rejects.toThrow("non-append");
  const forged=b(["h1","h2","h3"]);forged.events[0].event.steps=[{stepType:"replace",from:2,to:2}];
  await expect(saveProcessCheckpoint(o.db,{...meta,updatedAt:"2026-09-29T20:04:00Z",bundle:forged})).rejects.toThrow("non-append");
  o.db.close();
 });
});
