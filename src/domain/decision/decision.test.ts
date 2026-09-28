import{describe,expect,it}from"vitest";import{createAcademicDecision,decisionsAffecting}from"./decision";
const d=()=>createAcademicDecision({id:"d12",documentId:"doc",revision:4,kind:"interpretation",title:"  Ublažiti tvrdnju  ",rationale:"  Izvor ne podupire riječ dokazuje.  ",createdBy:"student",createdAt:"2026-09-28T12:00:00Z",affects:[{type:"claim",id:"c14"},{type:"claim",id:"c14"},{type:"section",id:"discussion"}]});
describe("AcademicDecision",()=>{
 it("stores a deliberate decision with rationale and revision",()=>{const x=d();expect(x.title).toBe("Ublažiti tvrdnju");expect(x.rationale).toBe("Izvor ne podupire riječ dokazuje.");expect(x.revision).toBe(4);});
 it("deduplicates affected objects",()=>expect(d().affects).toHaveLength(2));
 it("finds decisions by affected object",()=>expect(decisionsAffecting([d()],{type:"claim",id:"c14"}).map(x=>x.id)).toEqual(["d12"]));
 it("requires an explicit rationale",()=>expect(()=>createAcademicDecision({...d(),rationale:"  "})).toThrow("required"));
 it("rejects invalid revisions",()=>expect(()=>createAcademicDecision({...d(),revision:-1})).toThrow("revision"));
});
