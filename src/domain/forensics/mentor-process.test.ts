import{describe,expect,it}from"vitest";import{createForensicEvent,type ForensicEvent}from"./ledger";import{buildMentorProcessView,forensicDrillDown}from"./mentor-process";
const e=(sequence:number,payload:ForensicEvent["payload"])=>createForensicEvent({schemaVersion:1,id:"e"+sequence,documentId:"d",sequence,revision:sequence<3?3:4,occurredAt:`2026-09-29T09:00:0${sequence}Z`,actorId:"student",actorRole:"student",payload});
const events=[e(1,{kind:"insert-text",nodeId:"n",offset:0,text:"a"}),e(2,{kind:"paste",nodeId:"n",offset:1,text:"PASTE"}),e(3,{kind:"insert-text",nodeId:"n",offset:6,text:"b"})];
describe("Mentor Process View",()=>{
 it("never projects events beyond the explicit visibility boundary",()=>{const v=buildMentorProcessView({events,integrityVerified:true,visibleThroughSequence:2});expect(v.eventCount).toBe(2);expect(v.timeline.flatMap(x=>x.sourceEventIds)).not.toContain("e3");});
 it("filters semantic categories without losing forensic provenance",()=>{const v=buildMentorProcessView({events,integrityVerified:true,filter:"paste",visibleThroughSequence:3});expect(v.timeline).toHaveLength(1);expect(v.timeline[0]).toMatchObject({kind:"paste",sourceEventIds:["e2"]});});
 it("drill-down cannot reveal hidden later events even when requested by id",()=>expect(forensicDrillDown(events,["e2","e3"],2).map(x=>x.id)).toEqual(["e2"]));
 it("does not claim verified integrity when caller has not verified the ledger",()=>expect(buildMentorProcessView({events,integrityVerified:false,visibleThroughSequence:3}).integrity).toBe("unverified"));
});
