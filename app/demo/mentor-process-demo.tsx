"use client";
import{useEffect,useMemo,useRef,useState}from"react";
import{buildForensicWritingSessions,buildMentorProcessView,buildPlaybackPlan,createForensicEvent,forensicDrillDown,nextSessionSequence,replayUntil,type ForensicEvent,type PlaybackSpeed,type ProcessFilter}from"@/domain/forensics";
const E=(sequence:number,sec:number,payload:ForensicEvent["payload"])=>createForensicEvent({schemaVersion:1,id:"fp-"+sequence,documentId:"demo",sequence,revision:3,occurredAt:`2026-09-29T09:00:${String(sec).padStart(2,"0")}Z`,actorId:"student",actorRole:"student",payload});
const EVENTS:ForensicEvent[]=[
 E(1,1,{kind:"insert-text",nodeId:"n",offset:0,text:"R"}),
 E(2,2,{kind:"insert-text",nodeId:"n",offset:1,text:"e"}),
 E(3,3,{kind:"insert-text",nodeId:"n",offset:2,text:"z"}),
 E(4,8,{kind:"paste",nodeId:"n",offset:3,text:"ultati "}),
 E(5,12,{kind:"insert-text",nodeId:"n",offset:11,text:"p"}),
 E(6,13,{kind:"insert-text",nodeId:"n",offset:12,text:"o"}),
 E(7,14,{kind:"insert-text",nodeId:"n",offset:13,text:"k"}),
 E(8,20,{kind:"citation-insert",nodeId:"n",offset:14,sourceId:"lindblom-1959",locator:"81-82"}),
];
const FILTERS:readonly ProcessFilter[]=["all","manual-writing","paste","ai-use","source-work","revision-work","checkpoint"];
const LABEL:Record<ProcessFilter,string>={all:"Sve", "manual-writing":"Ručno pisanje",paste:"Paste","ai-use":"AI","source-work":"Izvori","revision-work":"Revizije",checkpoint:"Checkpoint"};
export default function MentorProcessDemo(){
 const[filter,setFilter]=useState<ProcessFilter>("all");const[sequence,setSequence]=useState(EVENTS.length);const[selected,setSelected]=useState<string|null>(null);const[playing,setPlaying]=useState(false);const[speed,setSpeed]=useState<PlaybackSpeed>(1);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const scope=useMemo(()=>({throughSequence:EVENTS.length,allowedRevisions:[3] as const,allowedNodeIds:["n"] as const}),[]);
 const view=useMemo(()=>buildMentorProcessView({events:EVENTS,integrityVerified:false,filter,scope}),[filter,scope]);
 const replay=useMemo(()=>replayUntil({nodes:[{id:"n",text:""}]},EVENTS,sequence),[sequence]);
 const sessions=useMemo(()=>buildForensicWritingSessions(EVENTS),[]);
 useEffect(()=>{if(timer.current){clearTimeout(timer.current);timer.current=null;}if(!playing||sequence>=EVENTS.length)return;const plan=buildPlaybackPlan(EVENTS,sequence+1,EVENTS.length,speed);const next=plan[0];if(!next)return;timer.current=setTimeout(()=>setSequence(next.sequence),next.delayMs);return()=>{if(timer.current){clearTimeout(timer.current);timer.current=null;}}},[playing,sequence,speed]);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
 function scrub(next:number){setPlaying(false);setSequence(next);}
 function jumpSession(){const next=nextSessionSequence(sessions,sequence);if(next!==null)scrub(next);}

 const item=view.timeline.find(x=>x.id===selected)??null;const proof=item?forensicDrillDown(EVENTS,item.sourceEventIds,scope):[];
 return <section className="card mentor-process-demo" aria-label="Mentorski proces pisanja">
  <div className="row" style={{justifyContent:"space-between"}}><div><strong>Proces pisanja</strong><p className="hint">Verificirani događaji unutar Pisač editora. Ne predstavlja procjenu mentalnog autorstva.</p></div><span className="review-chip">{view.integrity==="verified"?"Integritet verificiran":"Demo ledger · integritet nije kriptografski verificiran"}</span></div>
  <div className="card"><strong>Sažetak procesa</strong><p className="hint">Događaji: {view.eventCount} · ručni inserti: {view.rhythm.manualInsertEvents} · ručni znakovi: {view.rhythm.manualCharacters} · paste znakovi: {view.rhythm.pasteCharacters} · median ručnog intervala: {view.rhythm.medianManualInterEventMs??"—"} ms</p></div>
  <div className="card"><strong>Replay</strong><div className="row" style={{marginTop:".5rem"}}><button className="btn" onClick={()=>scrub(Math.max(0,sequence-1))}>Prethodni</button><button className="btn btn-primary" disabled={sequence>=EVENTS.length} aria-pressed={playing} onClick={()=>setPlaying(x=>!x)}>{playing?"Pauza":"Pokreni"}</button><button className="btn" onClick={()=>scrub(Math.min(EVENTS.length,sequence+1))}>Sljedeći</button><button className="btn" disabled={nextSessionSequence(sessions,sequence)===null} onClick={jumpSession}>Sljedeća sesija</button><select aria-label="Brzina reprodukcije" value={speed} onChange={e=>{setPlaying(false);setSpeed(Number(e.target.value) as PlaybackSpeed)}}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></div><input aria-label="Pozicija replaya" type="range" min={0} max={EVENTS.length} value={sequence} onChange={e=>scrub(Number(e.target.value))}/><p className="hint">Događaj {sequence}/{EVENTS.length} · sesije: {sessions.length}</p><div className="editor-surface" style={{minHeight:"5rem"}}>{replay.nodes[0].text||"Dokument je još prazan."}</div></div>
  <div className="card"><strong>Timeline</strong><div className="row">{FILTERS.map(f=><button key={f} className={"btn "+(filter===f?"btn-primary":"")} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{LABEL[f]}</button>)}</div>{view.timeline.map(x=><button key={x.id} className="btn" style={{width:"100%",justifyContent:"flex-start",marginTop:".5rem"}} onClick={()=>setSelected(x.id)}>{x.startedAt.slice(11,19)} · {x.summary}</button>)}</div>
  {item?<div className="card" aria-live="polite"><strong>Forensic dokaz</strong><p className="hint">Semantic item {item.id} izveden je iz {proof.length} ledger događaja.</p>{proof.map(e=><p key={e.id} className="hint"><b>#{e.sequence}</b> · {e.occurredAt.slice(11,23)} · {e.payload.kind} · {e.id}</p>)}</div>:null}
 </section>;
}
