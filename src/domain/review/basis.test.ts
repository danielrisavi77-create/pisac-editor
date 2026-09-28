import { describe, expect, it } from "vitest";
import { newNodeId } from "../document";
import { createTextAnchor } from "../collaboration";
import { createReviewBasis, evaluateReviewBasis } from "./basis";

const ID=newNodeId(()=>"11111111-1111-4111-8111-111111111111");
const OTHER=newNodeId(()=>"22222222-2222-4222-8222-222222222222");
function basis(text="važna tvrdnja"){
 const full="Uvod. "+text+" Kraj.";
 const start=full.indexOf(text);
 const target=createTextAnchor({nodeId:ID,nodeText:full,start,end:start+text.length,contextLength:0});
 return {full,b:createReviewBasis({requestId:"r1",acceptedRevision:3,target,reviewedText:text})};
}
describe("ReviewBasis",()=>{
 it("stays valid for unchanged content",()=>{const x=basis();expect(evaluateReviewBasis(x.b,ID,x.full)).toEqual({status:"VALID",resolution:"exact"});});
 it("stays valid when identical reviewed text merely moves",()=>{const x=basis();expect(evaluateReviewBasis(x.b,ID,"Novo. "+x.full)).toEqual({status:"VALID",resolution:"moved"});});
 it("requires rereview when reviewed text is changed",()=>{const x=basis();expect(evaluateReviewBasis(x.b,ID,"Uvod. snažnija tvrdnja Kraj.")).toEqual({status:"REREVIEW_REQUIRED",reason:"missing"});});
 it("requires rereview when the target is deleted",()=>{const x=basis();expect(evaluateReviewBasis(x.b,ID,"Uvod. Kraj.")).toEqual({status:"REREVIEW_REQUIRED",reason:"missing"});});
 it("requires rereview rather than guessing between duplicate matches",()=>{const x=basis();expect(evaluateReviewBasis(x.b,ID,"važna tvrdnja i važna tvrdnja")).toEqual({status:"REREVIEW_REQUIRED",reason:"ambiguous"});});
 it("requires rereview when the structural node changes",()=>{const x=basis();expect(evaluateReviewBasis(x.b,OTHER,x.full)).toEqual({status:"REREVIEW_REQUIRED",reason:"missing"});});
 it("refuses a basis whose reviewed text differs from its anchor",()=>{const x=basis();expect(()=>createReviewBasis({requestId:"r1",acceptedRevision:3,target:x.b.target,reviewedText:"drugo"})).toThrow("anchor quote");});
 it("fingerprint is stable for the same reviewed content",()=>{const a=basis().b,c=basis().b;expect(a.fingerprint).toBe(c.fingerprint);});
});
