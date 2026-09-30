import{describe,expect,it}from"vitest";import{buildProcessAnalytics,type AnalyticsSegment}from"./process-analytics";
const s=(id:string,start:string,end:string,events:number,status:"sealed"|"interrupted"="sealed"):AnalyticsSegment=>({sessionId:id,startedAt:start,updatedAt:end,eventCount:events,status,eventTimes:Array.from({length:events},(_,i)=>new Date(Date.parse(start)+i*1000).toISOString())});
describe("process analytics",()=>{
 it("reports segment duration separately from active transaction time",()=>{const a=buildProcessAnalytics([s("a","2026-09-28T10:00:00Z","2026-09-28T11:00:00Z",3)],{idleThresholdMs:5000});expect(a.segmentDurationMs).toBe(3600000);expect(a.activeTransactionSpanMs).toBe(2000);});
 it("groups sessions by explicit calendar date without calling it local timezone",()=>{const a=buildProcessAnalytics([s("a","2026-09-28T23:59:00Z","2026-09-29T00:01:00Z",1),s("b","2026-09-29T10:00:00Z","2026-09-29T10:01:00Z",1)],{idleThresholdMs:5000});expect(a.byUtcDate.map(x=>[x.date,x.sessions])).toEqual([["2026-09-28",1],["2026-09-29",1]]);});
 it("counts interrupted segments descriptively",()=>expect(buildProcessAnalytics([s("a","2026-09-28T10:00:00Z","2026-09-28T10:01:00Z",0,"interrupted")],{idleThresholdMs:5000}).interruptedSegments).toBe(1));
 it("does not expose authorship or AI probability scores",()=>{const a=buildProcessAnalytics([s("a","2026-09-28T10:00:00Z","2026-09-28T10:01:00Z",1)],{idleThresholdMs:5000});expect(a).not.toHaveProperty("aiProbability");expect(a).not.toHaveProperty("humanProbability");});
});
