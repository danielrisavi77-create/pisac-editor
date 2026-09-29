"use client";
import{useMemo,useState}from"react";
import{buildMentorQueue,groupMentorQueue,type MentorProjectInput,type WaitingOn}from"@/domain/mentor-command";

const INPUTS:MentorProjectInput[]=[
 {projectId:"p-daniel",studentId:"s-daniel",studentLabel:"Daniel Rišavi",workLabel:"Diplomski rad",lastActivityAt:"2026-09-29T10:41:00Z",reviewDeltaCount:6,studentResponseCount:2,neverReviewedCount:1,readinessBlockerCount:0,forensicAnomalyCount:0,finalReviewRequested:false,studentWorkPending:false},
 {projectId:"p-ana",studentId:"s-ana",studentLabel:"Ana Horvat",workLabel:"Završni rad",lastActivityAt:"2026-09-28T16:12:00Z",reviewDeltaCount:0,studentResponseCount:0,neverReviewedCount:0,readinessBlockerCount:0,forensicAnomalyCount:0,finalReviewRequested:false,studentWorkPending:true},
 {projectId:"p-marko",studentId:"s-marko",studentLabel:"Marko Marić",workLabel:"Diplomski rad",lastActivityAt:"2026-09-27T12:05:00Z",reviewDeltaCount:0,studentResponseCount:0,neverReviewedCount:0,readinessBlockerCount:0,forensicAnomalyCount:0,finalReviewRequested:false,studentWorkPending:false},
 {projectId:"p-petra",studentId:"s-petra",studentLabel:"Petra Novak",workLabel:"Diplomski rad",lastActivityAt:"2026-09-29T08:10:00Z",reviewDeltaCount:0,studentResponseCount:0,neverReviewedCount:0,readinessBlockerCount:2,forensicAnomalyCount:1,finalReviewRequested:true,studentWorkPending:false},
];
type View="all"|WaitingOn;
const LABEL:Record<View,string>={all:"Svi",mentor:"Treba moju pažnju",student:"Čeka studenta",none:"Bez otvorene akcije"};
const REASON:Record<string,string>={"review-delta":"akademski relevantne promjene","student-responses":"odgovori na dorade","never-reviewed":"nikad pregledani objekti","readiness-blockers":"blokeri za predaju","forensic-anomalies":"forensic anomalije","final-review-requested":"zatražen završni pregled"};

export default function MentorCommandCenterDemo(){
 const[view,setView]=useState<View>("mentor");const[selected,setSelected]=useState<string|null>(null);
 const queue=useMemo(()=>buildMentorQueue(INPUTS),[]);const groups=useMemo(()=>groupMentorQueue(queue),[queue]);
 const shown=view==="all"?queue:groups[view];const project=queue.find(x=>x.projectId===selected)??null;
 return <section className="card mentor-command-demo" aria-label="Mentor Command Center">
  <div><strong>Mentor Command Center</strong><p className="hint">Radna lista proizlazi iz workflow činjenica. Nema risk scorea ni procjene akademskog poštenja.</p></div>
  <div className="row">{(["mentor","student","none","all"] as const).map(v=><button key={v} className={"btn "+(view===v?"btn-primary":"")} aria-pressed={view===v} onClick={()=>{setView(v);setSelected(null)}}>{LABEL[v]} ({v==="all"?queue.length:groups[v].length})</button>)}</div>
  {!project?<div style={{marginTop:".75rem"}}>{shown.map(item=><button key={item.projectId} className="card" style={{display:"block",width:"100%",textAlign:"left"}} onClick={()=>setSelected(item.projectId)}><strong>{item.studentLabel} · {item.workLabel}</strong><p className="hint">Zadnja aktivnost: {item.lastActivityAt.replace("T"," ").slice(0,16)}</p>{item.reasons.length?<p>{item.reasons.map(r=>`${r.count} × ${REASON[r.kind]}`).join(" · ")}</p>:<p className="hint">{item.waitingOn==="student"?"Student još radi na sljedećoj verziji.":"Nema otvorene akcije."}</p>}</button>)}</div>:
  <div className="card" style={{marginTop:".75rem"}}><button className="btn" onClick={()=>setSelected(null)}>← Natrag na studente</button><h3>{project.studentLabel} · {project.workLabel}</h3><p className="hint">{LABEL[project.waitingOn]}</p><div className="row"><button className="btn btn-primary">Proces pisanja</button><button className="btn">Promjene</button><button className="btn">Dorade</button><button className="btn">Coverage</button><button className="btn">Argumenti</button><button className="btn">Provjere</button></div>{project.reasons.map(r=><p key={r.kind}><b>{r.count}</b> · {REASON[r.kind]}</p>)}</div>}
 </section>;
}
