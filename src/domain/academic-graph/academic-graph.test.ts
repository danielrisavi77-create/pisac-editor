import{describe,expect,it}from"vitest";import{objectsOfType,traceAcademicPaths,validateAcademicGraph,type AcademicGraph}from"./academic-graph";
const g:AcademicGraph={objects:[
{id:"RQ1",type:"research-question",label:"Kako X utječe na Y?",revision:1},
{id:"H1",type:"hypothesis",label:"X je pozitivno povezan s Y",revision:1},
{id:"D1",type:"dataset",label:"Anketa N=238",revision:4},
{id:"A1",type:"analysis",label:"Regresija",revision:4},
{id:"R1",type:"result",label:"β=.31, p=.031",revision:4},
{id:"C1",type:"claim",label:"Rezultati pokazuju povezanost",revision:4},
{id:"S5",type:"section",label:"Rasprava §5",revision:4},
{id:"K1",type:"conclusion",label:"Zaključak C1",revision:4},
],links:[
{id:"l1",from:"H1",to:"RQ1",relation:"addresses"},
{id:"l2",from:"D1",to:"A1",relation:"uses"},
{id:"l3",from:"A1",to:"R1",relation:"produces"},
{id:"l4",from:"R1",to:"C1",relation:"supports"},
{id:"l5",from:"C1",to:"S5",relation:"appears-in"},
{id:"l6",from:"S5",to:"K1",relation:"contributes-to"},
]};
describe("AcademicGraph",()=>{
 it("traces an explainable downstream research path",()=>{const p=traceAcademicPaths(g,"D1");expect(p.map(x=>x.target.id)).toEqual(["A1","R1","C1","S5","K1"]);expect(p.at(-1)?.links.map(x=>x.id)).toEqual(["l2","l3","l4","l5","l6"]);});
 it("returns typed subsets",()=>expect(objectsOfType(g,"claim").map(x=>x.id)).toEqual(["C1"]));
 it("reports orphan academic objects",()=>{const x={...g,objects:[...g.objects,{id:"ORPHAN",type:"concept" as const,label:"Nepovezan pojam",revision:1}]};expect(validateAcademicGraph(x)).toContainEqual({kind:"orphan",id:"ORPHAN"});});
 it("reports dangling and self links",()=>{const x={...g,links:[...g.links,{id:"bad",from:"C1",to:"MISSING",relation:"supports" as const},{id:"self",from:"C1",to:"C1",relation:"supports" as const}]};expect(validateAcademicGraph(x)).toEqual(expect.arrayContaining([{kind:"dangling-link",linkId:"bad",missingId:"MISSING"},{kind:"self-link",linkId:"self"}]));});
 it("breaks cycles deterministically",()=>{const x={...g,links:[...g.links,{id:"cycle",from:"K1",to:"D1",relation:"contributes-to" as const}]};expect(traceAcademicPaths(x,"D1").filter(p=>p.target.id==="D1")).toHaveLength(0);});
});
