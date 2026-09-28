import{describe,expect,it}from"vitest";import{createAcademicDecision}from"../decision";import{evaluateAnswerCoverage,questionsFromDecisions}from"./defense";
const decision=createAcademicDecision({id:"D12",documentId:"demo",revision:4,kind:"interpretation",title:"Ne koristiti riječ dokazuje bez dodatne potpore",rationale:"Izvor podupire oprezniju formulaciju i zahtijeva dodatnu potporu za snažniji zaključak.",createdBy:"student",createdAt:"2026-09-28T12:00:00Z",affects:[{type:"claim",id:"claim-014"},{type:"source",id:"lindblom-1959"}]});
describe("Defense Mode",()=>{
 it("derives a question from a real academic decision",()=>{const q=questionsFromDecisions([decision])[0];expect(q.prompt).toContain("Ne koristiti riječ dokazuje");expect(q.sourceDecisionIds).toEqual(["D12"]);});
 it("reports coverage without producing a score",()=>{const q=questionsFromDecisions([decision])[0];const r=evaluateAnswerCoverage(q,"Izvor zahtijeva dodatnu potporu pa sam zadržao oprezniju formulaciju.");expect(r.covered).toContain("razlog odluke");expect(r).not.toHaveProperty("score");});
 it("reports missing project concepts instead of judging answer quality",()=>{const q=questionsFromDecisions([decision])[0];const r=evaluateAnswerCoverage(q,"Odlučio sam tako zbog izvora.");expect(r.missing.length).toBeGreaterThan(0);});
 it("returns no questions when there are no deliberate decisions",()=>expect(questionsFromDecisions([])).toEqual([]));
});
