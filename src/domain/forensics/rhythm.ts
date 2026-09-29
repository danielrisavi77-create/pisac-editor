import type{ForensicEvent}from"./ledger";
export type RhythmMetrics={manualInsertEvents:number;manualCharacters:number;pasteCharacters:number;deleteCharacters:number;aiAcceptedCharacters:number;medianManualInterEventMs:number|null;writingBursts:number;longestBurstEvents:number};
function median(xs:number[]):number|null{if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
export function analyzeWritingRhythm(events:readonly ForensicEvent[],burstGapMs=2000):RhythmMetrics{
 if(!Number.isFinite(burstGapMs)||burstGapMs<=0)throw new Error("analyzeWritingRhythm: invalid burst gap");
 const student=[...events].filter(e=>e.actorRole==="student").sort((a,b)=>a.sequence-b.sequence);
 let manualInsertEvents=0,manualCharacters=0,pasteCharacters=0,deleteCharacters=0,aiAcceptedCharacters=0,writingBursts=0,longestBurstEvents=0,current=0;const manualGaps:number[]=[];let prevManualTime:number|null=null,prevManualNode:string|null=null;
 for(const e of student){
  if(e.payload.kind==="insert-text"){const now=Date.parse(e.occurredAt);manualInsertEvents++;manualCharacters+=e.payload.text.length;if(prevManualTime!==null&&prevManualNode===e.payload.nodeId)manualGaps.push(now-prevManualTime);if(prevManualTime===null||prevManualNode!==e.payload.nodeId||now-prevManualTime>burstGapMs){writingBursts++;current=1}else current++;longestBurstEvents=Math.max(longestBurstEvents,current);prevManualTime=now;prevManualNode=e.payload.nodeId;}
  else{current=0;if(e.payload.kind==="paste")pasteCharacters+=e.payload.text.length;if(e.payload.kind==="delete")deleteCharacters+=Math.max(0,e.payload.end-e.payload.start);if(e.payload.kind==="ai-accept")aiAcceptedCharacters+=e.payload.acceptedText.length;}
 }
 return{manualInsertEvents,manualCharacters,pasteCharacters,deleteCharacters,aiAcceptedCharacters,medianManualInterEventMs:median(manualGaps),writingBursts,longestBurstEvents};
}
