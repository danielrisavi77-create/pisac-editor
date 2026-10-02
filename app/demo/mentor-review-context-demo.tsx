"use client";

import { useEffect, useRef, useState } from "react";
import { buildMentorReviewContext } from "@/domain/mentor-review";
import type { ForensicEvent } from "@/domain/forensics";

const BEFORE = "Rezultati pokazuju povezanost promatranih varijabli.";
const AFTER = "Rezultati dokazuju povezanost promatranih varijabli.";
const NODE_ID = "demo-claim-014-node";
const DOCUMENT_ID = "demo-daniel-document";
const start = BEFORE.indexOf("pokazuju");

// Synthetic fixture, not a student's captured activity. These events really
// reconstruct the two displayed snapshots; they do not borrow fp-* IDs from
// the unrelated general process demo.
const EVENTS: readonly ForensicEvent[] = [
  {schemaVersion:1,id:"claim-014:001",documentId:DOCUMENT_ID,sequence:1,revision:3,
    occurredAt:"2026-09-29T09:00:08Z",actorId:"demo-student",actorRole:"student",
    payload:{kind:"paste",nodeId:NODE_ID,offset:0,text:BEFORE}},
  {schemaVersion:1,id:"claim-014:002",documentId:DOCUMENT_ID,sequence:2,revision:4,
    occurredAt:"2026-09-29T09:00:12Z",actorId:"demo-student",actorRole:"student",
    payload:{kind:"replace",nodeId:NODE_ID,start,end:start+"pokazuju".length,
      removedTextHash:"demo-not-cryptographically-verified",insertedText:"dokazuju"}},
];
const CONTEXT = buildMentorReviewContext({
  documentId:DOCUMENT_ID,nodeId:NODE_ID,reviewerId:"mentor",
  object:{id:"CLAIM-014",type:"claim",label:"CLAIM-014 · tvrdnja o povezanosti",revision:4},
  before:{revision:3,text:BEFORE},after:{revision:4,text:AFTER},
  evidence:[{id:"EB-014",label:"Demonstracijski izvor EB-014 — nije provjeren stvarni izvor",status:"recheck-required"}],
  downstreamFromObjectId:"CLAIM-014",
  downstream:[
    {target:{id:"S5.2",type:"section",label:"Rasprava §5.2",revision:4},links:[{id:"cx1",from:"CLAIM-014",to:"S5.2",relation:"appears-in"}]},
    {target:{id:"K6",type:"conclusion",label:"Zaključak §6",revision:2},links:[{id:"cx1",from:"CLAIM-014",to:"S5.2",relation:"appears-in"},{id:"cx2",from:"S5.2",to:"K6",relation:"contributes-to"}]},
  ],
  provenanceSource:{initialText:"",events:EVENTS,scope:{documentId:DOCUMENT_ID,reviewerId:"mentor",throughSequence:2,allowedRevisions:[3,4],allowedNodeIds:[NODE_ID]}},
});

export default function MentorReviewContextDemo() {
  const [documentOpen,setDocumentOpen] = useState(false);
  const [replayOpen,setReplayOpen] = useState(false);
  const [position,setPosition] = useState(0);
  const snapshotRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{if(documentOpen){snapshotRef.current?.focus();snapshotRef.current?.scrollIntoView({block:"nearest"});}},[documentOpen]);
  const proof = CONTEXT.provenance;
  const frame = position > 0 ? proof.frames[position-1] : null;
  return <section className="card" aria-label="Kontekst pregleda CLAIM-014">
    <p className="hint">Sintetski primjer za provjeru funkcije, ne zapis stvarnog studenta.</p>
    <h5>Prije → poslije</h5>
    <p><s>{CONTEXT.before?.text}</s></p><p><b>{CONTEXT.after.text}</b></p>
    <div className="row">
      <button className="btn" aria-expanded={documentOpen} onClick={()=>setDocumentOpen(x=>!x)}>Prikaži u dokumentu</button>
      <button className="btn" aria-expanded={replayOpen} disabled={proof.status!=="reconstructed"} onClick={()=>setReplayOpen(x=>!x)}>Prikaži nastanak ove tvrdnje</button>
    </div>
    {documentOpen?<div ref={snapshotRef} tabIndex={-1} role="region" aria-label="Podijeljeni demonstracijski dokument revizija 4" className="card">
      <h5>Rasprava §5.2 · podijeljeni snimak v4</h5>
      <p className="hint">Označeni odlomak iz demonstracijskog snimka. Ovo nije privatni nacrt ni sadržaj trenutačnog F1 editora.</p>
      <p id={NODE_ID}><mark>{CONTEXT.after.text}</mark></p>
    </div>:null}
    <h5>EvidenceBasis</h5>
    {CONTEXT.evidence.map(e=><p key={e.id}>{e.label} · <b>{e.status==="recheck-required"?"potrebna nova provjera":"pregledano za ovu formulaciju"}</b></p>)}
    <h5>Utjecaj</h5>
    {CONTEXT.downstream.map(p=><p key={p.target.id}>{p.target.label}</p>)}
    <h5>Kako je dio nastao</h5>
    <p className="hint">{proof.status==="reconstructed"?"Dostavljeni segment rekonstruira oba prikazana snimka. Hash-lanac, vrijeme i identitet nisu kriptografski verificirani.":"Nema potvrđene rekonstrukcije za ovaj objekt. Tuđi ili nepotpuni događaji nisu prikazani kao dokaz."}</p>
    {proof.frames.map(f=><p key={f.eventId} className="hint">#{f.sequence} · {f.kind==="paste"?"Lijepljenje teksta":"Zamjena teksta"} · događaj: {f.eventId}</p>)}
    {replayOpen&&proof.status==="reconstructed"?<section className="card" aria-label="Nastanak tvrdnje CLAIM-014">
      <label>Korak nastanka<input type="range" min={0} max={proof.frames.length} value={position} onChange={e=>setPosition(Number(e.target.value))}/></label>
      <p aria-live="polite">Korak {position}/{proof.frames.length}{frame?` · ${frame.eventId} · ${frame.occurredAt}`:" · početni snimak segmenta"}</p>
      <p data-claim-replay-text="">{frame?.text??proof.initialText??""}</p>
      <div className="row"><button className="btn" disabled={position===0} onClick={()=>setPosition(p=>p-1)}>Prethodni korak</button><button className="btn" disabled={position===proof.frames.length} onClick={()=>setPosition(p=>p+1)}>Sljedeći korak</button></div>
    </section>:null}
  </section>;
}
