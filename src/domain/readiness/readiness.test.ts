import{describe,expect,it}from"vitest";import{evaluateAcademicReadiness,type ReadinessInput}from"./readiness";
const clean=():ReadinessInput=>({graphIssues:[],coverage:[{object:{id:"C1",label:"Tvrdnja"},state:"CURRENTLY_COVERED"}],evidence:[{id:"E1",status:"VALID"}],protectedFacts:[{id:"N1",status:"UNCHANGED"}],analysis:[{id:"R1",status:"CURRENT"}],instructionIssues:[],lekta:{status:"clean",findingCount:0}});
describe("Academic Readiness Gate",()=>{
 it("is ready only when no blockers exist",()=>expect(evaluateAcademicReadiness(clean())).toEqual({readyForSubmission:true,findings:[]}));
 it("blocks stale analysis and invalid evidence",()=>{const x=clean();x.analysis=[{id:"R1",status:"STALE"}];x.evidence=[{id:"E1",status:"RECHECK_REQUIRED"}];const r=evaluateAcademicReadiness(x);expect(r.readyForSubmission).toBe(false);expect(r.findings.filter(f=>f.severity==="blocker")).toHaveLength(2);});
 it("treats mentor coverage gaps as explicit warnings, not fake scores",()=>{const x=clean();x.coverage=[{object:{id:"K1",label:"Zaključak"},state:"NEVER_REVIEWED"}];const r=evaluateAcademicReadiness(x);expect(r.readyForSubmission).toBe(true);expect(r.findings[0]).toMatchObject({area:"mentor-review",severity:"warning",sourceIds:["K1"]});expect(r).not.toHaveProperty("score");});
 it("blocks unverified protected facts",()=>{const x=clean();x.protectedFacts=[{id:"N1",status:"MISSING"}];expect(evaluateAcademicReadiness(x).readyForSubmission).toBe(false);});
 it("keeps an unrun Lekta check visible without inventing a blocker",()=>{const x=clean();x.lekta={status:"not-run",findingCount:0};expect(evaluateAcademicReadiness(x)).toMatchObject({readyForSubmission:true,findings:[{area:"lekta",severity:"warning"}]});});
});
