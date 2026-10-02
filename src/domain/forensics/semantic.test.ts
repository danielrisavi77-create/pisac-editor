import{describe,expect,it}from"vitest";import{createForensicEvent,type ForensicEvent}from"./ledger";import{projectSemanticProvenance}from"./semantic";
const mk=(sequence:number,sec:number,payload:ForensicEvent["payload"])=>createForensicEvent({schemaVersion:1,id:"e"+sequence,documentId:"d",sequence,revision:1,occurredAt:`2026-09-29T09:00:${String(sec).padStart(2,"0")}Z`,actorId:"student",actorRole:"student",payload});
describe("Semantic provenance",()=>{
 it("groups nearby manual inserts but keeps source event provenance",()=>{const r=projectSemanticProvenance([mk(1,1,{kind:"insert-text",nodeId:"n",offset:0,text:"a"}),mk(2,2,{kind:"insert-text",nodeId:"n",offset:1,text:"b"})]);expect(r).toEqual([expect.objectContaining({kind:"manual-writing",sourceEventIds:["e1","e2"],metrics:{characters:2,events:2}})]);});
 it("keeps paste distinct from manual writing",()=>{const r=projectSemanticProvenance([mk(1,1,{kind:"paste",nodeId:"n",offset:0,text:"abc"})]);expect(r[0]).toMatchObject({kind:"paste",sourceEventIds:["e1"],metrics:{characters:3}});});
 it("does not collapse AI into manual authorship",()=>{const r=projectSemanticProvenance([mk(1,1,{kind:"ai-request",interactionId:"a1",purpose:"language",promptHash:"p",contextHash:"c"})]);expect(r[0].kind).toBe("ai-use");});
});
