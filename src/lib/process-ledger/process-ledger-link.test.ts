import"fake-indexeddb/auto";import{afterEach,describe,expect,it}from"vitest";import Dexie from"dexie";import{markProcessInterrupted,openProcessLedger,saveProcessCheckpoint}from"./process-ledger";import type{CapturedProcess}from"@/editor/process-capture";
const name="pisac-process-ledger-link-test";afterEach(async()=>Dexie.delete(name));
const b=(id:string,head:string):CapturedProcess=>({format:"pisac-local-transactions-v1",schema:"pisac-f1-pm-v1",documentId:"d",sessionId:id,initialDocument:{type:"doc",content:[{type:"paragraph"}]},genesisHash:head,events:[],receipt:{eventCount:0,headHash:head,finalDocumentHash:"f"}});
describe("process ledger continuation integrity",()=>{
 it("rejects continuation while the latest parent is still active",async()=>{
  const o=await openProcessLedger(name);if(!o.ok)throw new Error("open");
  await saveProcessCheckpoint(o.db,{bundle:b("s1","h1"),status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:01:00Z",previousSessionHead:null});
  await expect(saveProcessCheckpoint(o.db,{bundle:b("s2","h2"),status:"active",startedAt:"2026-09-29T20:02:00Z",updatedAt:"2026-09-29T20:02:00Z",previousSessionHead:"h1"})).rejects.toThrow("parent-active");
  o.db.close();
 });
 it("rejects a continuation whose claimed terminal parent head does not exist",async()=>{
  const o=await openProcessLedger(name);if(!o.ok)throw new Error("open");
  await saveProcessCheckpoint(o.db,{bundle:b("s1","h1"),status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:01:00Z",previousSessionHead:null});
  await markProcessInterrupted(o.db,"d","s1","2026-09-29T20:01:00Z");
  await expect(saveProcessCheckpoint(o.db,{bundle:b("s2","h2"),status:"active",startedAt:"2026-09-29T20:02:00Z",updatedAt:"2026-09-29T20:02:00Z",previousSessionHead:"wrong"})).rejects.toThrow("missing-parent");
  await expect(saveProcessCheckpoint(o.db,{bundle:b("s3","h3"),status:"active",startedAt:"2026-09-29T20:03:00Z",updatedAt:"2026-09-29T20:03:00Z",previousSessionHead:null})).rejects.toThrow("missing-parent");
  o.db.close();
 });
 it("rejects a continuation whose start overlaps the terminal parent",async()=>{
  const o=await openProcessLedger(name);if(!o.ok)throw new Error("open");
  await saveProcessCheckpoint(o.db,{bundle:b("s1","h1"),status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:03:00Z",previousSessionHead:null});
  await markProcessInterrupted(o.db,"d","s1","2026-09-29T20:04:00Z");
  await expect(saveProcessCheckpoint(o.db,{bundle:b("s2","h2"),status:"active",startedAt:"2026-09-29T20:03:59Z",updatedAt:"2026-09-29T20:05:00Z",previousSessionHead:"h1"})).rejects.toThrow("overlap");
  o.db.close();
 });
});
