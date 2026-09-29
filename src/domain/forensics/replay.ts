import type{ForensicEvent}from"./ledger";
export type ReplayNode={id:string;text:string};export type ReplayDocument={nodes:readonly ReplayNode[]};
function update(nodes:readonly ReplayNode[],id:string,fn:(text:string)=>string):ReplayNode[]{let found=false;const out=nodes.map(n=>{if(n.id!==id)return n;found=true;return{...n,text:fn(n.text)}});if(!found)throw new Error(`replay: missing node ${id}`);return out;}
export function applyForensicEvent(doc:ReplayDocument,event:ForensicEvent):ReplayDocument{
 const p=event.payload;
 if(p.kind==="insert-text"||p.kind==="paste"){return{nodes:update(doc.nodes,p.nodeId,t=>t.slice(0,p.offset)+p.text+t.slice(p.offset))};}
 if(p.kind==="delete"||p.kind==="cut"){return{nodes:update(doc.nodes,p.nodeId,t=>t.slice(0,p.start)+t.slice(p.end))};}
 if(p.kind==="replace"){return{nodes:update(doc.nodes,p.nodeId,t=>t.slice(0,p.start)+p.insertedText+t.slice(p.end))};}
 if(p.kind==="paragraph-break"){return{nodes:update(doc.nodes,p.nodeId,t=>t.slice(0,p.offset)+"\n"+t.slice(p.offset))};}
 if(p.kind==="ai-accept"){throw new Error("replay: ai-accept requires a resolved target transaction");}
 return{nodes:doc.nodes.map(n=>({...n}))};
}
export function replayUntil(initial:ReplayDocument,events:readonly ForensicEvent[],sequence:number):ReplayDocument{
 return events.filter(e=>e.sequence<=sequence).sort((a,b)=>a.sequence-b.sequence).reduce(applyForensicEvent,initial);
}
