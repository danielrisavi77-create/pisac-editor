import{describe,expect,it}from"vitest";import{createForensicEvent,type ForensicEvent}from"./ledger";import{buildForensicWritingSessions}from"./sessions";
const e=(sequence:number,minute:number)=>createForensicEvent({schemaVersion:1,id:"e"+sequence,documentId:"d",sequence,revision:1,occurredAt:new Date(Date.UTC(2026,8,29,9,minute)).toISOString(),actorId:"student",actorRole:"student",payload:{kind:"insert-text",nodeId:"n",offset:0,text:"x"} it("rejects mixed-document streams",()=>{const other={...e(2,1),documentId:"other"};expect(()=>buildForensicWritingSessions([e(1,0),other])).toThrow("mixed documents");});
});
describe("Forensic writing sessions",()=>{
 it("splits sessions after the configured idle gap",()=>expect(buildForensicWritingSessions([e(1,0),e(2,1),e(3,30)]).map(x=>x.eventIds)).toEqual([["e1","e2"],["e3"]]));
 it("keeps sequence authoritative and reports timestamp regression",()=>{const r=buildForensicWritingSessions([e(1,2),e(2,1)]);expect(r[0].eventIds).toEqual(["e1","e2"]);expect(r[0].anomalies).toContainEqual({kind:"timestamp-regression",eventId:"e2"});});
 it("reports a sequence gap instead of silently repairing it",()=>{const r=buildForensicWritingSessions([e(1,0),e(3,1)]);expect(r[0].anomalies).toContainEqual({kind:"sequence-gap",eventId:"e3"});});
 it("does not count negative or idle time as active duration",()=>{expect(buildForensicWritingSessions([e(1,2),e(2,1)])[0].activeDurationMs).toBe(0);});
});
