import type{ForensicEvent}from"./ledger";
export type SessionAnomaly={kind:"timestamp-regression"|"sequence-gap";eventId:string};
export type ForensicWritingSession={id:string;documentId:string;firstSequence:number;lastSequence:number;startedAt:string;endedAt:string;eventIds:readonly string[];activeDurationMs:number;anomalies:readonly SessionAnomaly[]};
export function buildForensicWritingSessions(events:readonly ForensicEvent[],idleGapMs=15*60*1000):ForensicWritingSession[]{
 if(!Number.isFinite(idleGapMs)||idleGapMs<=0)throw new Error("buildForensicWritingSessions: invalid idle gap");
 const ordered=[...events].sort((a,b)=>a.sequence-b.sequence);const groups:{events:ForensicEvent[];anomalies:SessionAnomaly[]}[]=[];let previous:ForensicEvent|null=null;
 for(const e of ordered){
  const anomalies:SessionAnomaly[]=[];if(previous){if(e.sequence!==previous.sequence+1)anomalies.push({kind:"sequence-gap",eventId:e.id});if(Date.parse(e.occurredAt)<Date.parse(previous.occurredAt))anomalies.push({kind:"timestamp-regression",eventId:e.id});}
  const gap=previous?Date.parse(e.occurredAt)-Date.parse(previous.occurredAt):0;
  let g=groups.at(-1);if(!g||g.events[0].documentId!==e.documentId||gap>idleGapMs){g={events:[],anomalies:[]};groups.push(g);}g.events.push(e);g.anomalies.push(...anomalies);previous=e;
 }
 return groups.map((g,i)=>{const first=g.events[0],last=g.events.at(-1)!;let active=0;for(let x=1;x<g.events.length;x++){const d=Date.parse(g.events[x].occurredAt)-Date.parse(g.events[x-1].occurredAt);if(d>=0&&d<=idleGapMs)active+=d;}return{id:`session:${first.documentId}:${i+1}`,documentId:first.documentId,firstSequence:first.sequence,lastSequence:last.sequence,startedAt:first.occurredAt,endedAt:last.occurredAt,eventIds:g.events.map(e=>e.id),activeDurationMs:active,anomalies:g.anomalies};});
}
