import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { openProcessLedger, saveProcessCheckpoint, sealProcessSegment, loadProcessLedger, markProcessInterrupted, PROCESS_LEDGER_DB_NAME } from "./process-ledger";
import type { CapturedProcess } from "@/editor/process-capture";

const bundle=(sessionId:string,head:string):CapturedProcess=>({format:"pisac-local-transactions-v1",schema:"pisac-f1-pm-v1",documentId:"doc-1",sessionId,initialDocument:{type:"doc",content:[{type:"paragraph",attrs:{nodeId:"p1"}}]},genesisHash:head,events:[],receipt:{eventCount:0,headHash:head,finalDocumentHash:"doc-hash"}});
afterEach(async()=>{await Dexie.delete(PROCESS_LEDGER_DB_NAME);});

describe("durable process ledger",()=>{
 it("persists an active checkpoint across a fresh database handle",async()=>{
  const opened=await openProcessLedger();expect(opened.ok).toBe(true);if(!opened.ok)return;
  await saveProcessCheckpoint(opened.db,{bundle:bundle("s1","h1"),status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:01:00Z",previousSessionHead:null});
  opened.db.close();
  const reopened=await openProcessLedger();expect(reopened.ok).toBe(true);if(!reopened.ok)return;
  const loaded=await loadProcessLedger(reopened.db,"doc-1");expect(loaded.segments).toHaveLength(1);expect(loaded.segments[0]).toMatchObject({sessionId:"s1",status:"active"});reopened.db.close();
 });
 it("seals without allowing a later active checkpoint to overwrite the sealed segment",async()=>{
  const opened=await openProcessLedger();if(!opened.ok)throw new Error("open");
  await saveProcessCheckpoint(opened.db,{bundle:bundle("s1","gen-s1"),status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:01:00Z",previousSessionHead:null});
  await sealProcessSegment(opened.db,"doc-1","s1",bundle("s1","gen-s1"),"2026-09-29T20:02:00Z");
  await expect(saveProcessCheckpoint(opened.db,{bundle:bundle("s1","later"),status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:03:00Z",previousSessionHead:null})).rejects.toThrow("sealed");
  opened.db.close();
 });
 it("makes interruption terminal for checkpoint and seal writers",async()=>{
  const opened=await openProcessLedger();if(!opened.ok)throw new Error("open");
  const b=bundle("interrupted","hi");
  await saveProcessCheckpoint(opened.db,{bundle:b,status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:01:00Z",previousSessionHead:null});
  await markProcessInterrupted(opened.db,"doc-1","interrupted","2026-09-29T20:02:00Z");
  await expect(saveProcessCheckpoint(opened.db,{bundle:b,status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:03:00Z",previousSessionHead:null})).rejects.toThrow("interrupted");
  await expect(sealProcessSegment(opened.db,"doc-1","interrupted",b,"2026-09-29T20:03:00Z")).rejects.toThrow("interrupted");
  await markProcessInterrupted(opened.db,"doc-1","interrupted","2026-09-29T20:04:00Z");
  expect((await opened.db.segments.get(["doc-1","interrupted"]))?.updatedAt).toBe("2026-09-29T20:02:00Z");
  opened.db.close();
 });
 it("links a continuation to the exact previous terminal segment head",async()=>{
  const opened=await openProcessLedger();if(!opened.ok)throw new Error("open");
  await saveProcessCheckpoint(opened.db,{bundle:bundle("s1","h1"),status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:01:00Z",previousSessionHead:null});
  await markProcessInterrupted(opened.db,"doc-1","s1","2026-09-29T20:02:00Z");
  await saveProcessCheckpoint(opened.db,{bundle:bundle("s2","h2"),status:"active",startedAt:"2026-09-29T20:05:00Z",updatedAt:"2026-09-29T20:05:00Z",previousSessionHead:"h1"});
  const loaded=await loadProcessLedger(opened.db,"doc-1");expect(loaded.segments.map(x=>[x.sessionId,x.previousSessionHead])).toEqual([["s1",null],["s2","h1"]]);opened.db.close();
 });
 it("rejects checkpoint time rollback",async()=>{
  const opened=await openProcessLedger();if(!opened.ok)throw new Error("open");
  const b=bundle("rollback","hr");
  await saveProcessCheckpoint(opened.db,{bundle:b,status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:02:00Z",previousSessionHead:null});
  await expect(saveProcessCheckpoint(opened.db,{bundle:b,status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:01:00Z",previousSessionHead:null})).rejects.toThrow("time-rollback");
  opened.db.close();
 });
 it("rejects a seal timestamp before the latest durable checkpoint",async()=>{
  const opened=await openProcessLedger();if(!opened.ok)throw new Error("open");
  await saveProcessCheckpoint(opened.db,{bundle:bundle("seal-time","hs"),status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:02:00Z",previousSessionHead:null});
  await expect(sealProcessSegment(opened.db,"doc-1","seal-time",bundle("seal-time","hs"),"2026-09-29T20:01:59Z")).rejects.toThrow("invalid-seal");
  opened.db.close();
 });
 it("rejects an interruption timestamp before the latest durable checkpoint",async()=>{
  const opened=await openProcessLedger();if(!opened.ok)throw new Error("open");
  await saveProcessCheckpoint(opened.db,{bundle:bundle("time","ht"),status:"active",startedAt:"2026-09-29T20:00:00Z",updatedAt:"2026-09-29T20:02:00Z",previousSessionHead:null});
  await expect(markProcessInterrupted(opened.db,"doc-1","time","2026-09-29T20:01:59Z")).rejects.toThrow("invalid-time");
  opened.db.close();
 });
 it("does not silently delete structurally invalid persisted records",async()=>{
  const opened=await openProcessLedger();if(!opened.ok)throw new Error("open");
  await opened.db.segments.put({documentId:"doc-1",sessionId:"bad",status:"active",startedAt:"bad",updatedAt:"bad",previousSessionHead:null,bundle:{} as CapturedProcess});
  const loaded=await loadProcessLedger(opened.db,"doc-1");expect(loaded.invalidSessionIds).toEqual(["bad"]);expect(loaded.segments).toHaveLength(0);expect(await opened.db.segments.get(["doc-1","bad"])).toBeDefined();opened.db.close();
 });
});
