import{describe,expect,it}from"vitest";import{buildProcessHistory}from"./process-history";import{buildGlobalHistorySteps,moveGlobalHistoryCursor}from"./global-history-navigation";
describe("global gap-aware history navigation",()=>{
 const h=buildProcessHistory([{sessionId:"a",startedAt:"2026-09-28T10:00:00Z",updatedAt:"2026-09-28T10:10:00Z",status:"sealed",headHash:"h1",previousSessionHead:null,eventCount:2},{sessionId:"b",startedAt:"2026-09-29T10:00:00Z",updatedAt:"2026-09-29T10:10:00Z",status:"sealed",headHash:"h2",previousSessionHead:"h1",eventCount:1}]);
 it("makes the gap an addressable navigation step",()=>expect(buildGlobalHistorySteps(h).map(x=>x.kind)).toEqual(["session-start","event","event","gap","session-start","event"]));
 it("moves onto the gap rather than jumping between sessions",()=>{const s=buildGlobalHistorySteps(h);expect(s[moveGlobalHistoryCursor(s,2,1)].kind).toBe("gap");expect(s[moveGlobalHistoryCursor(s,3,1)]).toEqual({kind:"session-start",sessionId:"b"});});
 it("returns no steps for invalid history",()=>expect(buildGlobalHistorySteps({...h,valid:false})).toEqual([]));
});
