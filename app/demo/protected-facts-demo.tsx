"use client";

import { useMemo, useState } from "react";
import { createTextAnchor } from "@/domain/collaboration";
import { newNodeId } from "@/domain/document";
import { createProtectedFact, evaluateProtectedFact, type ProtectedFact, type ProtectedFactEvaluation } from "@/domain/verification";

const NODE=newNodeId(()=>"33333333-3333-4333-8333-333333333333");
const ORIGINAL="Uzorak: 238; rezultat: p = .031; pouzdanost: α = .84; termin: obvezno glasovanje.";
const SAFE="Konačni uzorak: 238; rezultat analize: p = .031; pouzdanost skale: α = .84; termin: obvezno glasovanje.";
const UNSAFE="Uzorak: 241; rezultat: p = .013; pouzdanost: α = .84; termin: obavezno glasanje.";

function makeFact(id:string,text:string,kind:ProtectedFact["kind"]):ProtectedFact{
 const start=ORIGINAL.indexOf(text);
 return createProtectedFact({id,kind,target:createTextAnchor({nodeId:NODE,nodeText:ORIGINAL,start,end:start+text.length,contextLength:0}),expectedText:text});
}
const FACTS=[makeFact("N-001","238","number"),makeFact("STAT-001","p = .031","statistic"),makeFact("STAT-002","α = .84","statistic"),makeFact("TERM-001","obvezno glasovanje","term")];

export default function ProtectedFactsDemo(){
 const [mode,setMode]=useState<"idle"|"safe"|"unsafe">("idle");
 const current=mode==="safe"?SAFE:mode==="unsafe"?UNSAFE:ORIGINAL;
 const results=useMemo(()=>FACTS.map(f=>({fact:f,result:evaluateProtectedFact(f,NODE,current)})),[current]);
 return <section className="protected-demo" aria-label="Protected Facts i Lekta demonstracija">
  <h2 style={{fontSize:"1.1rem",margin:"0 0 .25rem"}}>Protected Facts + Lekta</h2>
  <p className="hint">Lokalna simulacija Lekta rezultata. Nema API poziva niti stvarne Lekta obrade.</p>
  <div className="card">
   <strong>Zaštićeni elementi</strong>
   <div className="protected-list">{FACTS.map(f=><span className="protected-pill" key={f.id}>{f.id} · {f.expectedText}</span>)}</div>
  </div>
  <div className="card">
   <strong>Simulacija obrade</strong><div className="row" style={{marginTop:".65rem"}}><button className="btn" onClick={()=>setMode("safe")}>Sigurna Lekta simulacija</button><button className="btn" onClick={()=>setMode("unsafe")}>Problematična simulacija</button><button className="btn" onClick={()=>setMode("idle")}>Vrati izvornik</button></div>
   <p className="hint">Prije: {ORIGINAL}</p><p className="hint">Poslije: {current}</p>
  </div>
  {mode!=="idle"?<div className="card" data-protected-report={mode}><strong>Deterministička usporedba</strong>{results.map(({fact,result})=><FactResult key={fact.id} fact={fact} result={result}/>)}
   <p className="hint">Pisač ne prihvaća promijenjene zaštićene vrijednosti automatski. U produkciji bi korisnik pregledao Lekta before/after rezultat prije prihvaćanja repaira.</p>
  </div>:null}
 </section>;
}
function FactResult({fact,result}:{fact:ProtectedFact;result:ProtectedFactEvaluation}){
 const detail=result.status==="CHANGED"?`${result.before} → ${result.after}`:result.status==="UNCHANGED"?`nepromijenjeno · ${result.resolution}`:result.status.toLowerCase();
 return <div className="protected-result"><span><b>{fact.id}</b> · {fact.kind}</span><span className={result.status==="UNCHANGED"?"fact-ok":"fact-warn"}>{result.status} · {detail}</span></div>;
}
