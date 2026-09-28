"use client";
import {useMemo,useState} from "react";
import {createAnalysisResult,evaluateAnalysisResult,type DatasetArtifact} from "@/domain/lineage";
const D4:DatasetArtifact={id:"dataset-demo",version:"v4",fingerprint:"9c7-demo",label:"N=238"};
const D5:DatasetArtifact={id:"dataset-demo",version:"v5",fingerprint:"b31-demo",label:"N=241"};
export default function AnalysisLineageDemo(){
 const[dataset,setDataset]=useState(D4);const[rerun,setRerun]=useState(false);
 const oldResult=useMemo(()=>createAnalysisResult({id:"result-031",analysisId:"analysis-011",datasetId:D4.id,datasetVersion:D4.version,datasetFingerprint:D4.fingerprint,label:"Glavna analiza",value:"p = .031",confidence:"declared"}),[]);
 const evaluation=evaluateAnalysisResult(oldResult,dataset);
 return <section className="lineage-demo" aria-label="Dataset i analiza lineage">
  <h2 style={{fontSize:"1.1rem",margin:"0 0 .25rem"}}>Dataset → analiza → rezultat</h2>
  <p className="hint">Lokalna demonstracija. Analitički engine nije stvarno pokrenut.</p>
  <div className="card"><div className="lineage-step"><b>{dataset.version==="v4"?"DATASET-004":"DATASET-005"}</b><span>{dataset.label} · fingerprint {dataset.fingerprint}</span></div><div className="lineage-arrow">↓</div><div className="lineage-step"><b>ANALYSIS-011</b><span>deklarirana veza · nije reproducibilno izvršeno</span></div><div className="lineage-arrow">↓</div><div className="lineage-step"><b>{rerun?"RESULT-032":"RESULT-031"}</b><span>{rerun?"p = .044":oldResult.value}</span></div></div>
  <div className="card"><strong>Status</strong><p className={evaluation.status==="CURRENT"&&!rerun?"fact-ok":"fact-warn"}>{rerun?"Simulirani novi rezultat za v5 — i dalje deklariran, nije reproducibilno potvrđen.":evaluation.status==="CURRENT"?"Aktualno za DATASET-004":`Zastarjelo za trenutačni ulaz · ${evaluation.reason}`}</p>
   {dataset.version==="v4"?<button className="btn" onClick={()=>setDataset(D5)}>Zamijeni dataset v4 → v5</button>:!rerun?<button className="btn btn-primary" onClick={()=>setRerun(true)}>Simuliraj ponovno izvođenje</button>:<p className="hint">Posljedice za Protected Facts: N 238→241 i p .031→.044 treba zasebno pregledati. CLAIM-R01 se ne prepisuje automatski.</p>}
  </div>
 </section>;
}
