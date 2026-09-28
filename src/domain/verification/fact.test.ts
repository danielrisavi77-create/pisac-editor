import {describe,expect,it} from "vitest";import {newNodeId} from "../document";import {createTextAnchor} from "../collaboration";import {createProtectedFact,evaluateProtectedFact} from "./fact";
const N=newNodeId(()=>"11111111-1111-4111-8111-111111111111");
function fact(text:string,kind:"number"|"statistic"|"verbatim-quote"|"term"="number"){const full="Rezultat: "+text+" kraj.";const start=full.indexOf(text);return{full,f:createProtectedFact({id:"f1",kind,target:createTextAnchor({nodeId:N,nodeText:full,start,end:start+text.length,contextLength:0}),expectedText:text})};}
describe("ProtectedFact",()=>{
 it("keeps unchanged value valid",()=>{const x=fact("238");expect(evaluateProtectedFact(x.f,N,x.full)).toEqual({status:"UNCHANGED",resolution:"exact"});});
 it("allows the identical value to move",()=>{const x=fact("p = .031","statistic");expect(evaluateProtectedFact(x.f,N,"Novo. "+x.full)).toEqual({status:"UNCHANGED",resolution:"moved"});});
 it("does not guess a replacement when the protected quote no longer resolves",()=>{const x=fact("238");expect(evaluateProtectedFact(x.f,N,"Rezultat: 241 kraj.")).toEqual({status:"MISSING"});});
 it("reports deletion when no replacement occupies the span",()=>{const x=fact("238");expect(evaluateProtectedFact(x.f,N,"")).toEqual({status:"MISSING"});});
 it("refuses to guess duplicate protected text",()=>{const x=fact("238");expect(evaluateProtectedFact(x.f,N,"238 i 238")).toEqual({status:"AMBIGUOUS"});});
 it("protects Croatian terminology verbatim",()=>{const x=fact("obvezno glasovanje","term");expect(evaluateProtectedFact(x.f,N,x.full).status).toBe("UNCHANGED");});
});
