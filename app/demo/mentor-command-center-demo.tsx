"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { buildMentorQueue, groupMentorQueue, type MentorProjectInput, type WaitingOn } from "@/domain/mentor-command";
import { applyReviewAction, buildCoverageMap, buildMentorReviewDelta, createReviewQueue, currentReviewItem, type ObjectChange, type ReviewCoverageRecord, type ReviewQueueItem, type ReviewQueueState } from "@/domain/mentor-review";
import { traceAcademicPaths, type AcademicGraph } from "@/domain/academic-graph";
import { evaluateAcademicReadiness } from "@/domain/readiness";
import MentorReviewContextDemo from "./mentor-review-context-demo";
import { openAcademicObjectRegistry, loadAcademicObjectRegistry } from "@/lib/academic-object-registry/academic-object-registry-db";
import { openAcademicRevisionStore, loadAcademicRevisionLedger } from "@/lib/academic-revision/academic-revision-db";
import { openEvidenceBasisStore, loadEvidenceBasisLedger } from "@/lib/evidence-basis/evidence-basis-db";
import { openReviewCoverageStore, loadReviewCoverage } from "@/lib/mentor-review/review-coverage-db";
import { currentAcademicObjectBinding } from "@/domain/academic-graph/academic-object-registry";
import { evidenceReadinessInput } from "@/domain/academic-graph/evidence-readiness-adapter";
import { projectMentorProjectState } from "@/domain/mentor-command/revision-projector";

const INPUTS: MentorProjectInput[] = [
  {projectId:"p-daniel",studentId:"s-daniel",studentLabel:"Daniel Rišavi",workLabel:"Diplomski rad",lastActivityAt:"2026-09-29T10:41:00Z",reviewDeltaCount:6,studentResponseCount:2,neverReviewedCount:2,readinessBlockerCount:1,forensicAnomalyCount:0,finalReviewRequested:false,studentWorkPending:false},
  {projectId:"p-ana",studentId:"s-ana",studentLabel:"Ana Horvat",workLabel:"Završni rad",lastActivityAt:"2026-09-28T16:12:00Z",reviewDeltaCount:0,studentResponseCount:0,neverReviewedCount:0,readinessBlockerCount:0,forensicAnomalyCount:0,finalReviewRequested:false,studentWorkPending:true},
  {projectId:"p-marko",studentId:"s-marko",studentLabel:"Marko Marić",workLabel:"Diplomski rad",lastActivityAt:"2026-09-27T12:05:00Z",reviewDeltaCount:0,studentResponseCount:0,neverReviewedCount:0,readinessBlockerCount:0,forensicAnomalyCount:0,finalReviewRequested:false,studentWorkPending:false},
  {projectId:"p-petra",studentId:"s-petra",studentLabel:"Petra Novak",workLabel:"Diplomski rad",lastActivityAt:"2026-09-29T08:10:00Z",reviewDeltaCount:0,studentResponseCount:0,neverReviewedCount:0,readinessBlockerCount:2,forensicAnomalyCount:1,finalReviewRequested:true,studentWorkPending:false},
];
const GRAPH: AcademicGraph = {objects:[
  {id:"CLAIM-014",type:"claim",label:"CLAIM-014 · tvrdnja o povezanosti",revision:4},
  {id:"S5.2",type:"section",label:"Rasprava §5.2",revision:4},
  {id:"K6",type:"conclusion",label:"Zaključak §6",revision:2},
  {id:"RESULT-031",type:"result",label:"RESULT-031 · statistički rezultat",revision:5},
  {id:"SOURCE-024",type:"source",label:"SOURCE-024 · novi izvor",revision:1},
  {id:"H2",type:"hypothesis",label:"H2 · interpretacija hipoteze",revision:3},
],links:[]};
const REVIEWS: ReviewCoverageRecord[] = [
  {id:"r1",reviewerId:"mentor",objectId:"CLAIM-014",reviewedRevision:3,reviewedAt:"2026-09-20T10:00:00Z",status:"accepted"},
  {id:"r2",reviewerId:"mentor",objectId:"S5.2",reviewedRevision:3,reviewedAt:"2026-09-20T10:05:00Z",status:"reviewed"},
  {id:"r3",reviewerId:"mentor",objectId:"RESULT-031",reviewedRevision:4,reviewedAt:"2026-09-20T10:10:00Z",status:"reviewed"},
  {id:"r4",reviewerId:"mentor",objectId:"H2",reviewedRevision:2,reviewedAt:"2026-09-20T10:15:00Z",status:"reviewed"},
];
const CHANGES: ObjectChange[] = [
  {objectId:"CLAIM-014",revision:4,kind:"content"},{objectId:"S5.2",revision:4,kind:"evidence"},
  {objectId:"K6",revision:2,kind:"structure"},{objectId:"RESULT-031",revision:5,kind:"analysis"},
  {objectId:"SOURCE-024",revision:1,kind:"evidence"},{objectId:"H2",revision:3,kind:"content"},
];
type View = "all" | WaitingOn;
type Detail = "summary" | "review" | "revisions" | "arguments" | "checks" | "queue";
const LABEL: Record<View,string> = {all:"Svi",mentor:"Treba moju pažnju",student:"Čeka studenta",none:"Bez otvorene akcije"};
const REASON: Record<string,string> = {"review-delta":"akademski relevantne promjene","student-responses":"odgovori na dorade","never-reviewed":"nikad pregledani objekti","readiness-blockers":"blokeri za predaju","forensic-anomalies":"anomalije integriteta/procesa za tehnički pregled","final-review-requested":"zatražen završni pregled"};

function ReviewQueuePanel({state,note,setNote,setState}:{
  state:ReviewQueueState|null;note:string;setNote:(v:string)=>void;
  setState:Dispatch<SetStateAction<ReviewQueueState|null>>;
}) {
  if(!state)return null;
  const item=currentReviewItem(state);
  if(!item)return <div role="region" aria-label="Mentor Review Queue"><h4>Kraj ovog prolaza</h4><p>Audit događaji: {state.audits.length} · coverage zapisi: {state.coverage.length}.</p><p className="hint">Preskočeno nije pregledano; završetak prolaza nije odobrenje rada.</p></div>;
  function act(action:"reviewed"|"revision-requested"|"commented"|"skipped") {
    // Allocate identifiers/time once outside the state updater. Never fabricate
    // timestamps from an audit counter (which used to reach minute 60).
    const id=crypto.randomUUID(); const occurredAt=new Date().toISOString();
    const expectedObject=item?.object.id; const expectedRevision=item?.object.revision;
    setState(previous=>{
      if(!previous)return previous;
      const current=currentReviewItem(previous);
      if(current?.object.id!==expectedObject||current?.object.revision!==expectedRevision)return previous;
      return applyReviewAction(previous,{reviewerId:"mentor",action,occurredAt,auditId:`demo-audit-${id}`,coverageId:action==="reviewed"?`demo-coverage-${id}`:undefined,note:note.trim()||undefined});
    });
    setNote("");
  }
  const contextAvailable=item.object.id==="CLAIM-014";
  return <div role="region" aria-label="Mentor Review Queue">
    <p className="hint">Stavka {state.cursor+1}/{state.items.length}</p>
    <h4>{item.object.label}</h4>
    <p>{item.contextLabel} · revizija {item.object.revision} · razlog: {item.reason==="changed"?"promijenjeno nakon pregleda":"novo za pregled"}</p>
    {contextAvailable?<MentorReviewContextDemo/>:<p className="hint">Detaljni dokumentni kontekst nije učitan za ovaj demo objekt. Označavanje pregledanim nije dostupno bez sadržaja.</p>}
    <textarea aria-label="Mentorska bilješka" value={note} onChange={e=>setNote(e.target.value)} placeholder="Bilješka ili razlog dorade"/>
    <div className="row">
      <button className="btn btn-primary" disabled={!contextAvailable} onClick={()=>act("reviewed")}>Označi pregledano</button>
      <button className="btn" disabled={!note.trim()} onClick={()=>act("revision-requested")}>Traži doradu</button>
      <button className="btn" disabled={!note.trim()} onClick={()=>act("commented")}>Komentiraj</button>
      <button className="btn" onClick={()=>act("skipped")}>Preskoči</button>
    </div>
    <p className="hint">Audit događaji: {state.audits.length} · novi coverage zapisi: {state.coverage.length}</p>
    <p className="hint">Pregled teksta ne potvrđuje automatski izvor. Zahtjev za doradu ostaje lokalni zapis; nije poslan studentu.</p>
  </div>;
}

export default function MentorCommandCenterDemo() {
  const [view,setView]=useState<View>("mentor");
  const [selected,setSelected]=useState<string|null>(null);
  const [details,setDetails]=useState<Detail>("summary");
  const [language,setLanguage]=useState(false);
  const [note,setNote]=useState("");
  const [reviewQueue,setReviewQueue]=useState<ReviewQueueState|null>(null);
  const [liveClaim,setLiveClaim]=useState<null|{revision:number;reviews:ReviewCoverageRecord[];evidence:{id:string;status:"VALID"|"RECHECK_REQUIRED"}[];sealedAt:string|null}>(null);
  const [liveClaimError,setLiveClaimError]=useState("");
  useEffect(()=>{let cancelled=false;const load=async()=>{
    const [registryOpen,revisionOpen,evidenceOpen,coverageOpen]=await Promise.all([
      openAcademicObjectRegistry("pisac-academic-object-registry-demo"),
      openAcademicRevisionStore("pisac-academic-revisions-demo"),
      openEvidenceBasisStore("pisac-evidence-basis-demo"),
      openReviewCoverageStore("pisac-review-coverage-demo")
    ]);
    if(cancelled)return;
    if(!registryOpen.ok||!revisionOpen.ok||!evidenceOpen.ok||!coverageOpen.ok){setLiveClaimError("local-lifecycle-unavailable");return;}
    try{
      const [registryResult,revisionResult,evidenceResult,reviews]=await Promise.all([
        loadAcademicObjectRegistry(registryOpen.db),loadAcademicRevisionLedger(revisionOpen.db),loadEvidenceBasisLedger(evidenceOpen.db),loadReviewCoverage(coverageOpen.db)
      ]);
      if(cancelled)return;
      if(!registryResult.ok||!revisionResult.ok||!evidenceResult.ok){setLiveClaimError("local-lifecycle-invalid");return;}
      const binding=currentAcademicObjectBinding(registryResult.registry,"CLAIM-014");
      if(!binding){setLiveClaim(null);return;}
      const sealed=revisionResult.ledger.revisions.filter(x=>x.objectId==="CLAIM-014").sort((a,b)=>a.revision-b.revision).at(-1)??null;
      setLiveClaim({revision:binding.objectRevision,reviews:reviews.filter(x=>x.objectId==="CLAIM-014"),evidence:evidenceReadinessInput(evidenceResult.ledger,"CLAIM-014",binding.objectRevision),sealedAt:sealed?.sealedAt??null});
    }catch{if(!cancelled)setLiveClaimError("local-lifecycle-read-failed");}
    finally{registryOpen.db.close();revisionOpen.db.close();evidenceOpen.db.close();coverageOpen.db.close();}
  };void load();const onUpdate=()=>{if(!cancelled)void load()};window.addEventListener("pisac:lifecycle-updated",onUpdate);return()=>{cancelled=true;window.removeEventListener("pisac:lifecycle-updated",onUpdate);};},[]);
  const reviews=useMemo(()=>[...REVIEWS,...(reviewQueue?.coverage??[])],[reviewQueue]);
  const coverage=useMemo(()=>buildCoverageMap(GRAPH,reviews,"mentor"),[reviews]);
  const delta=useMemo(()=>buildMentorReviewDelta(GRAPH,reviews,"mentor",CHANGES,{includeLanguageOnly:language}),[reviews,language]);
  const readiness=useMemo(()=>evaluateAcademicReadiness({graphIssues:[],coverage,
    evidence:[{id:"EB-014",status:"RECHECK_REQUIRED"}],
    protectedFacts:[{id:"N-001",status:"UNCHANGED"},{id:"STAT-001",status:"UNCHANGED"}],
    analysis:[{id:"RESULT-031",status:"CURRENT"}],instructionIssues:[],lekta:{status:"not-run",findingCount:0}}),[coverage]);
  // The card, detail and readiness view read the SAME derived state.
  const liveClaimProjection=useMemo(()=>liveClaim?projectMentorProjectState({projectId:"p-daniel",studentId:"s-daniel",studentLabel:"Daniel Rišavi",workLabel:"Diplomski rad",lastActivityAt:liveClaim.sealedAt??"2026-09-29T10:41:00Z",reviewerId:"mentor",object:{id:"CLAIM-014",type:"claim",label:"CLAIM-014 · stvarni lokalni lifecycle",revision:liveClaim.revision},reviews:liveClaim.reviews,changes:[{objectId:"CLAIM-014",revision:liveClaim.revision,kind:"content"}],evidence:liveClaim.evidence,evidenceRecheckOwner:"student"}):null,[liveClaim]);
  const queue=useMemo(()=>buildMentorQueue(INPUTS.map(input=>input.projectId==="p-daniel"?{
    ...input,reviewDeltaCount:liveClaimProjection?Math.max(0,buildMentorReviewDelta(GRAPH,reviews,"mentor",CHANGES).filter(x=>x.object.id!=="CLAIM-014").length)+liveClaimProjection.input.reviewDeltaCount:buildMentorReviewDelta(GRAPH,reviews,"mentor",CHANGES).length,
    neverReviewedCount:liveClaimProjection?coverage.filter(x=>x.object.id!=="CLAIM-014"&&x.state==="NEVER_REVIEWED").length+liveClaimProjection.input.neverReviewedCount:coverage.filter(x=>x.state==="NEVER_REVIEWED").length,
    readinessBlockerCount:liveClaimProjection?evaluateAcademicReadiness({graphIssues:[],coverage:coverage.filter(x=>x.object.id!=="CLAIM-014"),evidence:[],protectedFacts:[{id:"N-001",status:"UNCHANGED"},{id:"STAT-001",status:"UNCHANGED"}],analysis:[{id:"RESULT-031",status:"CURRENT"}],instructionIssues:[],lekta:{status:"not-run",findingCount:0}}).findings.filter(x=>x.severity==="blocker").length+liveClaimProjection.input.readinessBlockerCount:readiness.findings.filter(x=>x.severity==="blocker").length,
    studentWorkPending:liveClaimProjection?.queue.waitingOn==="student"||input.studentWorkPending,
  }:input)),[reviews,coverage,readiness,liveClaimProjection]);
  const groups=useMemo(()=>groupMentorQueue(queue),[queue]);
  const shown=view==="all"?queue:groups[view];
  const project=queue.find(x=>x.projectId===selected)??null;
  const reviewItems=useMemo<ReviewQueueItem[]>(()=>delta.map(x=>({object:x.object,reason:x.kind==="new"?"new":"changed",contextLabel:x.object.type==="conclusion"?"Zaključak §6":x.object.type==="section"?"Rasprava §5.2":"Akademski objekt"})),[delta]);
  const argumentPath=useMemo(()=>traceAcademicPaths({objects:[...GRAPH.objects,
    {id:"DATASET-004",type:"dataset",label:"DATASET-004 · N=238",revision:4},
    {id:"ANALYSIS-011",type:"analysis",label:"ANALYSIS-011 · regresija",revision:4}],links:[
    {id:"a1",from:"DATASET-004",to:"ANALYSIS-011",relation:"uses"},
    {id:"a2",from:"ANALYSIS-011",to:"RESULT-031",relation:"produces"},
    {id:"a3",from:"RESULT-031",to:"CLAIM-014",relation:"supports"},
    {id:"a4",from:"CLAIM-014",to:"S5.2",relation:"appears-in"},
    {id:"a5",from:"S5.2",to:"K6",relation:"contributes-to"}]} ,"DATASET-004"),[]);
  function openProject(id:string){setSelected(id);setDetails("summary");setNote("");}
  function startReview(){
    setReviewQueue(previous=>{
      if(previous&&currentReviewItem(previous))return previous;
      return {...createReviewQueue(reviewItems),audits:previous?.audits??[],coverage:previous?.coverage??[]};
    });
    setDetails("queue");setNote("");
  }
  return <section className="card mentor-command-demo" aria-label="Mentor Command Center">
    <div><strong>Mentor Command Center</strong><p className="hint">Hibridni lokalni demo: CLAIM-014 koristi trajni revision/coverage/evidence lifecycle kada postoji; ostali akademski objekti još su sintetski fixturei. Nema risk scorea ni procjene akademskog poštenja.</p>{liveClaim?<p data-testid="command-live-claim"><b>CLAIM-014 live:</b> rev. {liveClaim.revision} · {liveClaimProjection?.coverage[0]?.state} · delta {liveClaimProjection?.delta.length} · čeka {liveClaimProjection?.queue.waitingOn}</p>:null}{liveClaimError?<p role="alert">Live CLAIM-014 projekcija nije dostupna ({liveClaimError}).</p>:null}</div>
    <div className="row">{(["mentor","student","none","all"] as const).map(v=><button key={v} className={"btn "+(view===v?"btn-primary":"")} aria-pressed={view===v} onClick={()=>{setView(v);setSelected(null);setDetails("summary")}}>{LABEL[v]} ({v==="all"?queue.length:groups[v].length})</button>)}</div>
    {!project?<div style={{marginTop:".75rem"}}>{shown.map(item=><button key={item.projectId} className="card" style={{display:"block",width:"100%",textAlign:"left"}} onClick={()=>openProject(item.projectId)}>
      <strong>{item.studentLabel} · {item.workLabel}</strong><p className="hint">Zadnja aktivnost: {item.lastActivityAt.slice(0,10)}</p>
      {item.reasons.length?<p>{item.reasons.map(r=>`${r.count} × ${REASON[r.kind]}`).join(" · ")}</p>:<p className="hint">{item.waitingOn==="student"?"Student još radi na sljedećoj verziji.":"Nema otvorene akcije."}</p>}
    </button>)}</div>:<div className="card" style={{marginTop:".75rem"}}>
      <button className="btn" onClick={()=>setSelected(null)}>← Natrag na studente</button>
      <h3>{project.studentLabel} · {project.workLabel}</h3><p className="hint">{LABEL[project.waitingOn]}</p>
      {project.projectId==="p-daniel"?<div className="row">
        <a className="btn" href="#mentor-process-view">Opći demo procesa pisanja</a>
        <button className="btn" onClick={()=>setDetails("review")}>Promjene i coverage</button>
        <button className="btn" onClick={()=>setDetails("revisions")}>Dorade</button>
        <button className="btn" onClick={()=>setDetails("arguments")}>Argumenti</button>
        <button className="btn" onClick={()=>setDetails("checks")}>Provjere</button>
        <button className="btn btn-primary" onClick={startReview}>{reviewQueue&&currentReviewItem(reviewQueue)?"Nastavi pregled":"Pokreni pregled"}</button>
      </div>:<p className="hint">Detaljni dokument i događaji ovog demo projekta nisu učitani; drugi projekt nije korišten kao zamjena.</p>}
      {project.projectId!=="p-daniel"||details==="summary"?project.reasons.map(r=><p key={r.kind}><b>{r.count}</b> · {REASON[r.kind]}</p>):details==="review"?<div>
        <label className="row"><input type="checkbox" checked={language} onChange={e=>setLanguage(e.target.checked)}/> Uključi čisto jezične promjene</label>
        <h4>Promijenjeno od zadnjeg pregleda</h4><p aria-live="polite">Preostalo za pregled: {delta.length}</p>
        <div data-mentor-delta="">{delta.map(x=><p key={x.object.id}><b>{x.object.label}</b> · {x.kind==="new"?"novo za pregled":`revizija ${x.lastReviewedRevision} → ${x.currentRevision}`} · {x.changeKinds.join(", ")||"nova stavka"}</p>)}</div>
        <h4>Coverage Map</h4><div data-mentor-coverage="">{coverage.map(x=><p key={x.object.id}>{x.object.label} · <b>{x.state==="CURRENTLY_COVERED"?"aktualno pregledano":x.state==="CHANGED_SINCE_REVIEW"?"promijenjeno nakon pregleda":"nikad pregledano"}</b></p>)}</div>
      </div>:details==="revisions"?<div><h4>Dorade</h4><p><b>2</b> odgovora studenta čekaju mentorski pregled.</p><p className="hint">Početni demonstracijski odgovori nisu automatski riješeni oznakom pregleda.</p>
        {reviewQueue?.audits.filter(a=>a.action==="revision-requested").map(a=><p key={a.id}>Lokalni zahtjev za {a.itemObjectId}: {a.note}</p>)}
      </div>:details==="arguments"?<div><h4>Argumentacijski put</h4>{argumentPath.map(x=><p key={x.target.id}>{x.target.label}</p>)}</div>:details==="checks"?<div>
        <h4>Academic Readiness</h4><p><b>{readiness.readyForSubmission?"Nema blokera":"Postoje otvoreni blokeri"}</b></p>
        {readiness.findings.map(x=><p key={x.id}><b>{x.severity==="blocker"?"BLOKER":"UPOZORENJE"}</b> · {x.message}</p>)}
      </div>:<ReviewQueuePanel state={reviewQueue} note={note} setNote={setNote} setState={setReviewQueue}/>}
    </div>}
  </section>;
}
