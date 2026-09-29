import{describe,expect,it}from"vitest";import{buildMentorQueue,groupMentorQueue,type MentorProjectInput}from"./command-center";
const base:MentorProjectInput={projectId:"p1",studentId:"s1",studentLabel:"Daniel",workLabel:"Diplomski",waitingOn:"mentor",lastActivityAt:"2026-09-29T10:00:00Z",reviewDeltaCount:6,studentResponseCount:2,neverReviewedCount:1,readinessBlockerCount:0,forensicAnomalyCount:0,finalReviewRequested:false};
describe("Mentor Command Center",()=>{
 it("explains why a project needs attention without a risk score",()=>{const x=buildMentorQueue([base])[0];expect(x.reasons).toEqual([{kind:"review-delta",count:6},{kind:"student-responses",count:2},{kind:"never-reviewed",count:1}]);expect(x).not.toHaveProperty("score");});
 it("surfaces forensic anomalies as facts, not misconduct conclusions",()=>{const x=buildMentorQueue([{...base,forensicAnomalyCount:2}])[0];expect(x.reasons).toContainEqual({kind:"forensic-anomalies",count:2});});
 it("groups workflow by who is expected to act next",()=>{const q=buildMentorQueue([base,{...base,projectId:"p2",waitingOn:"student"},{...base,projectId:"p3",waitingOn:"none"}]);const g=groupMentorQueue(q);expect(g.mentor).toHaveLength(1);expect(g.student).toHaveLength(1);expect(g.none).toHaveLength(1);});
});
