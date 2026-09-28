import{describe,expect,it}from"vitest";import{searchResearchMemory,type MemoryItem}from"./memory";
const items:MemoryItem[]=[
{id:"1",ownerId:"student",projectId:"p1",projectLabel:"Diplomski",type:"claim",title:"Inkrementalizam",text:"Lindblom i sukcesivne ograničene usporedbe",provenance:"§2 · CLAIM-014",access:"owned"},
{id:"2",ownerId:"student",projectId:"p0",projectLabel:"Seminarski 2025",type:"decision",title:"Teorijski okvir",text:"Usporedba inkrementalizma i mixed-scanninga",provenance:"D4",access:"owned"},
{id:"3",ownerId:"other",projectId:"secret",projectLabel:"Tuđi privatni rad",type:"claim",title:"Inkrementalizam tajno",text:"Savršen tekst o inkrementalizmu",provenance:"private",access:"owned"},
{id:"4",ownerId:"other",projectId:"shared",projectLabel:"Zajednički projekt",type:"source",title:"Lindblom 1959",text:"inkrementalizam",provenance:"biblioteka",access:"shared",sharedWith:["student"]},
];
describe("Research Memory",()=>{
 it("finds owned matching academic objects with provenance",()=>{const r=searchResearchMemory(items,"student","inkrementalizam");expect(r.map(x=>x.item.id)).toContain("1");expect(r[0].item.provenance).toBeTruthy();});
 it("never returns another user's private item even for a perfect match",()=>expect(searchResearchMemory(items,"student","inkrementalizam").map(x=>x.item.id)).not.toContain("3"));
 it("returns explicitly shared material",()=>expect(searchResearchMemory(items,"student","Lindblom").map(x=>x.item.id)).toContain("4"));
 it("returns nothing for an empty query",()=>expect(searchResearchMemory(items,"student","  ")).toEqual([]));
 it("does not mutate or copy content into another project",()=>{const before=JSON.stringify(items);searchResearchMemory(items,"student","inkrementalizam");expect(JSON.stringify(items)).toBe(before);});
});
