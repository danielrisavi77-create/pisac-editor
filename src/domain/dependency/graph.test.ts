import { describe,expect,it } from "vitest";
import { analyzeImpact,createDependencyEdge,type DependencyEdge } from "./graph";
const edges:DependencyEdge[]=[
 {id:"e1",from:{type:"source",id:"s1"},to:{type:"claim",id:"c1"},kind:"supports"},
 {id:"e2",from:{type:"claim",id:"c1"},to:{type:"section",id:"discussion"},kind:"used_by"},
 {id:"e3",from:{type:"section",id:"discussion"},to:{type:"section",id:"conclusion"},kind:"affects"},
];
describe("Dependency impact",()=>{
 it("returns downstream objects with explainable paths",()=>{
  const r=analyzeImpact({type:"claim",id:"c1"},edges);
  expect(r.map(x=>[x.object.id,x.depth])).toEqual([["discussion",1],["conclusion",2]]);
  expect(r[1].path.map(x=>x.id)).toEqual(["e2","e3"]);
 });
 it("does not travel upstream unless an explicit edge exists",()=>expect(analyzeImpact({type:"claim",id:"c1"},edges).some(x=>x.object.id==="s1")).toBe(false));
 it("breaks cycles without duplicating the start object",()=>{
  const cyclic=[...edges,{id:"e4",from:{type:"section",id:"conclusion"},to:{type:"claim",id:"c1"},kind:"affects"}] as DependencyEdge[];
  expect(analyzeImpact({type:"claim",id:"c1"},cyclic).map(x=>x.object.id)).toEqual(["discussion","conclusion"]);
 });
 it("deduplicates an object reached by more than one path",()=>{
  const x=[...edges,{id:"e5",from:{type:"claim",id:"c1"},to:{type:"section",id:"conclusion"},kind:"affects"}] as DependencyEdge[];
  expect(analyzeImpact({type:"claim",id:"c1"},x).filter(i=>i.object.id==="conclusion")).toHaveLength(1);
 });
 it("honors the depth guard",()=>expect(analyzeImpact({type:"claim",id:"c1"},edges,1).map(x=>x.object.id)).toEqual(["discussion"]));
 it("rejects self edges",()=>expect(()=>createDependencyEdge({id:"x",from:{type:"claim",id:"c"},to:{type:"claim",id:"c"},kind:"affects"})).toThrow("self edge"));
});
