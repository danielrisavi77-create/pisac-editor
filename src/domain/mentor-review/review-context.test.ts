import{describe,expect,it}from"vitest";import{buildMentorReviewContext}from"./review-context";
const base={object:{id:"C1",type:"claim" as const,label:"Tvrdnja",revision:4},before:{revision:3,text:"Rezultati pokazuju povezanost."},after:{revision:4,text:"Rezultati dokazuju povezanost."},evidence:[{id:"E1",label:"Lindblom 1959 · 81–82",status:"recheck-required" as const}],downstreamFromObjectId:"C1",downstream:[],provenance:[{id:"manual:e1:e2",kind:"manual-writing" as const,startedAt:"2026-09-29T09:00:00Z",endedAt:"2026-09-29T09:00:01Z",sourceEventIds:["e1","e2"],summary:"Ručno uneseno 2 znakova.",metrics:{characters:2}}]};
describe("Mentor review context bundle",()=>{
 it("binds the current text to the exact academic object revision",()=>expect(buildMentorReviewContext(base).after.revision).toBe(4));
 it("rejects a stale after snapshot",()=>expect(()=>buildMentorReviewContext({...base,after:{revision:3,text:"staro"}})).toThrow("after revision mismatch"));
 it("rejects impact context attributed to a different object",()=>expect(()=>buildMentorReviewContext({...base,downstreamFromObjectId:"OTHER"})).toThrow("origin mismatch"));
 it("requires forensic semantic items to retain source-event provenance",()=>expect(()=>buildMentorReviewContext({...base,provenance:[{...base.provenance[0],sourceEventIds:[]}]})).toThrow("without source events"));
});
