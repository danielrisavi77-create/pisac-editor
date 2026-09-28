"use client";

import { useMemo, useState } from "react";
import { createTextAnchor, createRevisionRequest, submitStudentResponse, shareResponseForReview, acceptForRevision, createSharePackage, type RevisionRequestState, type SharePackageId } from "@/domain/collaboration";
import { createReviewBasis, evaluateReviewBasis } from "@/domain/review";
import { projectReviewAttention } from "@/domain/attention";
import { newNodeId } from "@/domain/document";
import { createClaimRevision, createEvidenceBasis, evaluateEvidenceBasis, type ClaimId, type SourceId, type EvidenceBasisId } from "@/domain/evidence";

type Stage = "comment" | "request" | "responded" | "shared" | "accepted" | "private-v4" | "shared-v4";
const NODE=newNodeId(()=>"11111111-1111-4111-8111-111111111111");
const V3="Lindblom kritizira racionalno-sveobuhvatni model zbog pretpostavke potpune analize alternativa.";
const V4="Lindblom dokazuje da je racionalno-sveobuhvatni model neprimjenjiv u stvarnom političkom odlučivanju.";

export default function DemoCollaborationPanel(){
 const [stage,setStage]=useState<Stage>("comment");
 const [view,setView]=useState<"student"|"mentor">("student");
 const [flow,setFlow]=useState<RevisionRequestState|null>(null);
 const anchor=useMemo(()=>createTextAnchor({nodeId:NODE,nodeText:V3,start:0,end:V3.length,contextLength:0}),[]);
 const basis=useMemo(()=>stage==="accepted"||stage==="private-v4"||stage==="shared-v4"?createReviewBasis({requestId:"demo-request",acceptedRevision:3,target:anchor,reviewedText:V3}):null,[stage,anchor]);
 const evaluation=basis?evaluateReviewBasis(basis,NODE,stage==="private-v4"||stage==="shared-v4"?V4:V3):null;
 const shares=stage==="shared-v4"?[createSharePackage({id:"share-v4" as SharePackageId,documentId:"demo",ownerId:"student",recipientId:"mentor",scope:{revision:4,visibility:"review"},createdAt:"2026-09-28T12:00:00Z"})]:[];
 const evidenceBasis=useMemo(()=>createEvidenceBasis({
  id:"demo-eb" as EvidenceBasisId,
  claim:createClaimRevision({claimId:"claim-014" as ClaimId,documentRevision:3,target:anchor,text:V3}),
  source:{sourceId:"lindblom-1959" as SourceId,version:"v1",title:"The Science of Muddling Through",locatorLabel:"str. 81–82"},
  excerpt:{sourceId:"lindblom-1959" as SourceId,sourceVersion:"v1",locator:"81–82",text:"Sažeti relevantni izvadak za demonstraciju.",kind:"summary"},
  reviewedAt:"2026-09-28T12:00:00Z"
 }),[anchor]);
 const evidenceEval=evaluateEvidenceBasis(evidenceBasis,NODE,stage==="private-v4"||stage==="shared-v4"?V4:V3,"v1");
 const attention=evaluation?projectReviewAttention({requestId:"demo-request",documentId:"demo",currentRevision:stage==="private-v4"||stage==="shared-v4"?4:3,evaluation,ownerId:"student",sharePackages:shares},view==="student"?{kind:"owner",userId:"student"}:{kind:"recipient",userId:"mentor"}):[];

 function convert(){const request=createRevisionRequest({id:"demo-request",documentId:"demo",createdBy:"mentor",requestedRevision:2,target:anchor,instruction:"Preciziraj tvrdnju i objasni izmjenu."});setFlow({request,response:null});setStage("request");}
 function respond(){if(!flow)return;const r=submitStudentResponse(flow,{requestId:"demo-request",authorId:"student",responseRevision:3,explanation:"Ublažio sam tvrdnju i precizirao pretpostavku modela."});if(r.ok){setFlow(r.value);setStage("responded");}}
 function share(){if(!flow)return;const r=shareResponseForReview(flow);if(r.ok){setFlow(r.value);setStage("shared");setView("mentor");}}
 function accept(){if(!flow)return;const r=acceptForRevision(flow);if(r.ok){setFlow(r.value);setStage("accepted");}}
 return <section className="collab-demo" aria-label="Demo dorade i pregleda">
  <div className="row" style={{justifyContent:"space-between"}}>
   <h2 style={{fontSize:"1.1rem",margin:0}}>Dorada 2.0</h2>
   <div className="row"><button className={"btn "+(view==="student"?"btn-primary":"")} onClick={()=>setView("student")}>Student</button><button className={"btn "+(view==="mentor"?"btn-primary":"")} onClick={()=>setView("mentor")}>Mentor</button></div>
  </div>
  <p className="hint">Lokalna demonstracija. Nema backenda, stvarnog dijeljenja ni autorizacije.</p>
  <div className="card collab-card">
   <strong>Berto Šalaj · komentar na v2</strong><p>Provjeri ovu tvrdnju i preciznije definiraj racionalno-sveobuhvatni model.</p>
   {stage==="comment"?<button className="btn btn-primary" onClick={convert}>Pretvori u doradu</button>:<span className="review-chip">Dorada · {flow?.request.status}</span>}
  </div>
  {stage!=="comment"&&view==="student"&&<div className="card collab-card"><strong>Odgovor studenta</strong><p className="hint">{stage==="request"?"Privatno — mentor ovo još ne vidi.":"Odgovor je pripremljen za reviziju 3."}</p>{stage==="request"&&<button className="btn btn-primary" onClick={respond}>Primijeni izmjenu i odgovor</button>}{stage==="responded"&&<button className="btn btn-primary" onClick={share}>Simuliraj dijeljenje v3</button>}</div>}
  {stage==="shared"&&view==="mentor"&&<div className="card collab-card"><strong>Pregled prije / poslije</strong><p><del>{V3}</del></p><p>{V3}</p><button className="btn btn-primary" onClick={accept}>Prihvati za v3</button></div>}
  {stage==="accepted"&&<div className="card collab-card"><strong>ReviewBasis v3</strong><p className="hint">Pregled je vezan uz točnu formulaciju i reviziju 3.</p>{view==="student"&&<button className="btn" onClick={()=>setStage("private-v4")}>Simuliraj privatnu sadržajnu izmjenu v4</button>}</div>}
  {(stage==="private-v4"||stage==="shared-v4")&&<div className="card collab-card"><strong>{view==="student"?"Trenutačni privatni tekst":"Podijeljeni tekst"}</strong><p>{V4}</p>{stage==="private-v4"&&view==="student"&&<button className="btn btn-primary" onClick={()=>setStage("shared-v4")}>Simuliraj dijeljenje v4 mentoru</button>}</div>}
  <div className="card collab-card"><strong>Tvrdnja + izvor</strong><p>{stage==="private-v4"||stage==="shared-v4"?V4:V3}</p><p className="hint">Lindblom 1959 · str. 81–82 · EvidenceBasis za formulaciju v3</p><span className="review-chip">{evidenceEval.status==="VALID"?"Potpora pregledana za v3":"Potrebna nova provjera izvora"}</span></div>
  <div className="card collab-card" data-attention-count={attention.length + ((evidenceEval.status==="RECHECK_REQUIRED" && (view==="student" || stage==="shared-v4"))?1:0)}><strong>Pažnja ({attention.length + ((evidenceEval.status==="RECHECK_REQUIRED" && (view==="student" || stage==="shared-v4"))?1:0)})</strong>{attention.length===0?<p className="hint">{view==="mentor"&&stage==="private-v4"?"Nema novih podijeljenih stavki. Privatna v4 nije otkrivena.":"Nema stavki koje zahtijevaju pažnju."}</p>:attention.map(x=><p key={x.id} className="attention-item">Potreban ponovni pregled · revizija {x.revision} · {x.visibility}</p>)}{evidenceEval.status==="RECHECK_REQUIRED" && (view==="student" || stage==="shared-v4")?<p className="attention-item">Potrebna nova provjera izvora · EvidenceBasis vrijedi za staru formulaciju v3.</p>:null}</div>
 </section>;
}
