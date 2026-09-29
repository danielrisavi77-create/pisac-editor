import type{ForensicEvent}from"./ledger";
export type SemanticProvenanceKind="manual-writing"|"paste"|"ai-use"|"source-work"|"revision-work"|"checkpoint";
export type SemanticProvenanceItem={id:string;kind:SemanticProvenanceKind;startedAt:string;endedAt:string;sourceEventIds:readonly string[];summary:string;metrics:Readonly<Record<string,number>>};

export function projectSemanticProvenance(events:readonly ForensicEvent[],manualGapMs=2000):SemanticProvenanceItem[]{
 const ordered=[...events].sort((a,b)=>a.sequence-b.sequence);const out:SemanticProvenanceItem[]=[];let burst:ForensicEvent[]=[];
 const flush=()=>{if(!burst.length)return;out.push({id:`manual:${burst[0].id}:${burst.at(-1)!.id}`,kind:"manual-writing",startedAt:burst[0].occurredAt,endedAt:burst.at(-1)!.occurredAt,sourceEventIds:burst.map(e=>e.id),summary:`Ručno uneseno ${burst.reduce((n,e)=>n+(e.payload.kind==="insert-text"?e.payload.text.length:0),0)} znakova.`,metrics:{characters:burst.reduce((n,e)=>n+(e.payload.kind==="insert-text"?e.payload.text.length:0),0),events:burst.length}});burst=[];};
 for(const e of ordered){
  if(e.payload.kind==="insert-text"){const prev=burst.at(-1);if(prev&&Date.parse(e.occurredAt)-Date.parse(prev.occurredAt)>manualGapMs)flush();burst.push(e);continue;}
  flush();
  if(e.payload.kind==="paste")out.push({id:`paste:${e.id}`,kind:"paste",startedAt:e.occurredAt,endedAt:e.occurredAt,sourceEventIds:[e.id],summary:`Zalijepljeno ${e.payload.text.length} znakova.`,metrics:{characters:e.payload.text.length}});
  else if(["ai-request","ai-response","ai-accept","ai-reject"].includes(e.payload.kind))out.push({id:`ai:${e.id}`,kind:"ai-use",startedAt:e.occurredAt,endedAt:e.occurredAt,sourceEventIds:[e.id],summary:`AI događaj: ${e.payload.kind}.`,metrics:{}});
  else if(e.payload.kind==="source-attach"||e.payload.kind==="citation-insert")out.push({id:`source:${e.id}`,kind:"source-work",startedAt:e.occurredAt,endedAt:e.occurredAt,sourceEventIds:[e.id],summary:`Rad s izvorom: ${e.payload.kind}.`,metrics:{}});
  else if(e.payload.kind==="checkpoint")out.push({id:`checkpoint:${e.id}`,kind:"checkpoint",startedAt:e.occurredAt,endedAt:e.occurredAt,sourceEventIds:[e.id],summary:"Kriptografski checkpoint dokumenta.",metrics:{}});
  else if(e.payload.kind==="structure-change")out.push({id:`revision:${e.id}`,kind:"revision-work",startedAt:e.occurredAt,endedAt:e.occurredAt,sourceEventIds:[e.id],summary:`Strukturna promjena: ${e.payload.from} → ${e.payload.to}.`,metrics:{}});
 }
 flush();return out;
}
