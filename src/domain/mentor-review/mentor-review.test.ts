import{describe,expect,it}from"vitest";import{buildCoverageMap,coverageSummary,type ReviewCoverageRecord}from"./coverage";import{buildMentorReviewDelta}from"./delta";import type{AcademicGraph}from"../academic-graph";
const graph:AcademicGraph={objects:[{id:"C1",type:"claim",label:"Tvrdnja",revision:4},{id:"S5",type:"section",label:"Rasprava",revision:3},{id:"K1",type:"conclusion",label:"Zaključak",revision:2}],links:[]};
const reviews:ReviewCoverageRecord[]=[{id:"r1",reviewerId:"mentor",objectId:"C1",reviewedRevision:3,reviewedAt:"2026-09-20T10:00:00Z",status:"accepted"},{id:"r2",reviewerId:"mentor",objectId:"S5",reviewedRevision:3,reviewedAt:"2026-09-21T10:00:00Z",status:"reviewed"},{id:"other",reviewerId:"other",objectId:"K1",reviewedRevision:2,reviewedAt:"2026-09-22T10:00:00Z",status:"reviewed"}];
describe("Mentor coverage",()=>{
 it("distinguishes current, changed and never reviewed",()=>{const x=buildCoverageMap(graph,reviews,"mentor");expect(x.map(i=>[i.object.id,i.state])).toEqual([["C1","CHANGED_SINCE_REVIEW"],["S5","CURRENTLY_COVERED"],["K1","NEVER_REVIEWED"]]);});
 it("summarizes mentor workload without a quality score",()=>expect(coverageSummary(buildCoverageMap(graph,reviews,"mentor"))).toEqual({currentlyCovered:1,changedSinceReview:1,neverReviewed:1}));
 it("delta contains only changed or never-reviewed objects",()=>expect(buildMentorReviewDelta(graph,reviews,"mentor").map(x=>[x.object.id,x.kind])).toEqual([["C1","changed"],["K1","new"]]));
 it("never borrows another reviewer's coverage",()=>expect(buildCoverageMap(graph,reviews,"mentor").find(x=>x.object.id==="K1")?.state).toBe("NEVER_REVIEWED"));
});
