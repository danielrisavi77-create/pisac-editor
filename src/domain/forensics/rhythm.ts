import type{ForensicEvent}from"./ledger";
export type RhythmMetrics={manualInsertEvents:number;manualCharacters:number;pasteCharacters:number;deleteCharacters:number;aiAcceptedCharacters:number;medianInterEventMs:number|null;writingBursts:number;longestBurstEvents:number};
function median(xs:number[]):number|null{if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
export function analyzeWritingRhythm(events:readonly ForensicEvent[],burstGapMs=2000):RhythmMetrics{
 const student=[...events].filter(e=>e.actorRole==="student").sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));
 let manualInsertEvents=0,manualCharacters=0,pasteCharacters=0,deleteCharacters=0,aiAcceptedCharacters=0,writingBursts=0,longestBurstEvents=0,current=0;const gaps:number[]=[];let prev:number|null=null;
 for(const e of student){const now=Date.parse(e.occurredAt);if(prev!==null)gaps.push(now-prev);const authoring=e.payload.kind==="insert-text";if(authoring){manualInsertEvents++;manualCharacters+=e.payload.text.length;if(prev===null||now-prev>burstGapMs){writingBursts++;current=1}else current++;longestBurstEvents=Math.max(longestBurstEvents,current);}else current=0;
 if(e.payload.kind==="paste")pasteCharacters+=e.payload.text.length;if(e.payload.kind==="delete")deleteCharacters+=Math.max(0,e.payload.end-e.payload.start);if(e.payload.kind==="ai-accept")aiAcceptedCharacters+=e.payload.acceptedText.length;prev=now;}
 return{manualInsertEvents,manualCharacters,pasteCharacters,deleteCharacters,aiAcceptedCharacters,medianInterEventMs:median(gaps),writingBursts,longestBurstEvents};
}
