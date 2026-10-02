import type{ForensicEvent}from"./ledger";import type{ForensicWritingSession}from"./sessions";
export const PLAYBACK_SPEEDS=[0.5,1,2,4]as const;export type PlaybackSpeed=(typeof PLAYBACK_SPEEDS)[number];
export type PlaybackStep={sequence:number;delayMs:number};
export function buildPlaybackPlan(events:readonly ForensicEvent[],fromSequence:number,toSequence:number,speed:PlaybackSpeed,maxDelayMs=1500):PlaybackStep[]{
 if(!PLAYBACK_SPEEDS.includes(speed)||!Number.isFinite(maxDelayMs)||maxDelayMs<0)throw new Error("buildPlaybackPlan: invalid options");
 const selected=events.filter(e=>e.sequence>=fromSequence&&e.sequence<=toSequence).sort((a,b)=>a.sequence-b.sequence);const out:PlaybackStep[]=[];
 for(let i=0;i<selected.length;i++){const prev=selected[i-1];const raw=prev?Math.max(0,Date.parse(selected[i].occurredAt)-Date.parse(prev.occurredAt)):0;out.push({sequence:selected[i].sequence,delayMs:Math.min(maxDelayMs,Math.round(raw/speed))});}
 return out;
}
export function nextSessionSequence(sessions:readonly ForensicWritingSession[],currentSequence:number):number|null{
 const next=sessions.find(s=>s.firstSequence>currentSequence);return next?.firstSequence??null;
}
