export type MemoryObjectType = "claim" | "source" | "decision" | "concept";
export type MemoryAccess = "owned" | "shared";
export type MemoryItem = {
  id: string;
  ownerId: string;
  projectId: string;
  projectLabel: string;
  type: MemoryObjectType;
  title: string;
  text: string;
  provenance: string;
  access: MemoryAccess;
  sharedWith?: readonly string[];
};

export type MemoryResult = {
  item: MemoryItem;
  matchedTerms: readonly string[];
};

function terms(value:string):string[]{
 return [...new Set(value.toLocaleLowerCase("hr-HR").match(/\p{L}[\p{L}\p{M}-]{2,}/gu)??[])];
}
function canRead(item:MemoryItem,viewerId:string):boolean{
 return item.ownerId===viewerId || (item.access==="shared" && (item.sharedWith??[]).includes(viewerId));
}
export function searchResearchMemory(items:readonly MemoryItem[],viewerId:string,query:string):MemoryResult[]{
 const q=terms(query);if(!viewerId||q.length===0)return[];
 return items.filter(i=>canRead(i,viewerId)).map(item=>{
  const hay=terms(`${item.title} ${item.text} ${item.provenance}`);
  const matched=q.filter(t=>hay.some(h=>h.includes(t)||t.includes(h)));
  return{item,matchedTerms:matched};
 }).filter(r=>r.matchedTerms.length>0).sort((a,b)=>b.matchedTerms.length-a.matchedTerms.length||a.item.title.localeCompare(b.item.title,"hr"));
}
