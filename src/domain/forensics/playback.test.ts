import{describe,expect,it}from"vitest";import{createForensicEvent}from"./ledger";import{buildPlaybackPlan,nextSessionSequence}from"./playback";import{buildForensicWritingSessions}from"./sessions";
const e=(sequence:number,sec:number)=>createForensicEvent({schemaVersion:1,id:"e"+sequence,documentId:"d",sequence,revision:1,occurredAt:`2026-09-29T09:00:${String(sec).padStart(2,"0")}Z`,actorId:"student",actorRole:"student",payload:{kind:"insert-text",nodeId:"n",offset:0,text:"x"}});
describe("Playback plan",()=>{
 it("scales event delays and caps long pauses",()=>expect(buildPlaybackPlan([e(1,0),e(2,1),e(3,9)],1,3,2)).toEqual([{sequence:1,delayMs:0},{sequence:2,delayMs:500},{sequence:3,delayMs:1500}]));
 it("jumps to the first event of the next writing session",()=>{const sessions=buildForensicWritingSessions([e(1,0),e(2,1),e(3,40)]);expect(nextSessionSequence(sessions,1)).toBe(3);expect(nextSessionSequence(sessions,3)).toBeNull();});
});
