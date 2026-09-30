import{describe,expect,it}from"vitest";import{buildObjectEvolution,type AcademicObjectBinding,type EvolutionSession}from"./object-evolution";
const sessions:EvolutionSession[]=[{sessionId:"s1",startedAt:"2026-09-28T10:00:00Z",eventCount:3},{sessionId:"s2",startedAt:"2026-09-29T10:00:00Z",eventCount:2}];
const bindings:AcademicObjectBinding[]=[{objectId:"CLAIM-014",objectType:"claim",revision:3,sessionId:"s1",eventIndexes:[1,2],beforeText:"pokazuju",afterText:"upućuju",evidenceIds:["SRC-1"]},{objectId:"CLAIM-014",objectType:"claim",revision:4,sessionId:"s2",eventIndexes:[0],beforeText:"upućuju",afterText:"dokazuju",evidenceIds:["SRC-1","SRC-2"]}];
describe("academic object evolution",()=>{
 it("builds revision chronology only from explicit event bindings",()=>{const e=buildObjectEvolution("CLAIM-014",sessions,bindings);expect(e.revisions.map(x=>[x.revision,x.sessionId,x.eventIndexes])).toEqual([[3,"s1",[1,2]],[4,"s2",[0]]]);expect(e.revisions[1].addedEvidenceIds).toEqual(["SRC-2"]);});
 it("rejects bindings to missing events instead of inferring them from text",()=>expect(()=>buildObjectEvolution("CLAIM-014",sessions,[{...bindings[0],eventIndexes:[99]}])).toThrow("event out of range"));
 it("rejects contradictory duplicate revision snapshots",()=>expect(()=>buildObjectEvolution("CLAIM-014",sessions,[bindings[0],{...bindings[0],afterText:"drugo"}])).toThrow("conflicting revision"));
 it("rejects duplicate or unordered event bindings",()=>{expect(()=>buildObjectEvolution("CLAIM-014",sessions,[{...bindings[0],eventIndexes:[2,1]}])).toThrow("invalid event order");expect(()=>buildObjectEvolution("CLAIM-014",sessions,[{...bindings[0],eventIndexes:[1,1]}])).toThrow("invalid event order");});
 it("does not include another academic object in the lineage",()=>{const e=buildObjectEvolution("CLAIM-014",sessions,[...bindings,{...bindings[0],objectId:"RESULT-031"}]);expect(e.revisions).toHaveLength(2);});
});
