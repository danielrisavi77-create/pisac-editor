"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Editor, EditorEvents } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import DocumentEditor, { type EditorProps } from "@/editor/Editor";
import { LocalProcessCapture, replayCapturedProcess, type CapturedProcess } from "@/editor/process-capture";
import { verifyAndBuildProcessHistory, type VerifiedHistorySegment } from "@/domain/forensics/verified-process-history";
import type { ProcessHistory } from "@/domain/forensics/process-history";
import { buildGlobalHistorySteps, moveGlobalHistoryCursor } from "@/domain/forensics/global-history-navigation";
import { buildProcessAnalytics } from "@/domain/forensics/process-analytics";
import { academicObjectBindingIntervals, currentAcademicObjectBinding, type AcademicObjectRegistry } from "@/domain/academic-graph/academic-object-registry";
import { deriveVerifiedObjectActivity, type VerifiedObjectActivity } from "@/domain/forensics/verified-object-activity";
import { appendPersistedAcademicBinding, loadAcademicObjectRegistry, openAcademicObjectRegistry, type AcademicObjectRegistryDatabase } from "@/lib/academic-object-registry/academic-object-registry-db";
import { loadProcessLedger, markProcessInterrupted, openProcessLedger, saveProcessCheckpoint, sealProcessSegment, type ProcessLedgerDatabase } from "@/lib/process-ledger/process-ledger";

type Status = "idle" | "recording" | "verifying" | "verified-local" | "failed";
const LABEL: Record<Status, string> = {
  idle: "Bilježenje nije uključeno.",
  recording: "Bilježe se dokumentne promjene u ovoj sesiji.",
  verifying: "Provjeravam SHA-256 lanac i rekonstrukciju…",
  "verified-local": "SHA-256 lanac i rekonstrukcija podudaraju se za završenu lokalnu sesiju.",
  failed: "Zapis nije potvrđen kao potpun. Uređivanje i spremanje dokumenta nastavljaju raditi.",
};
function renderNode(node: PMNode, key: string): ReactNode {
  if (node.isText) {
    let text: ReactNode = node.text ?? "";
    for (const mark of node.marks) {
      if (mark.type.name === "bold") text = <strong>{text}</strong>;
      else if (mark.type.name === "italic") text = <em>{text}</em>;
    }
    return <span key={key}>{text}</span>;
  }
  const children: ReactNode[] = [];
  node.forEach((child, _offset, index) => children.push(renderNode(child, `${key}:${index}`)));
  if (node.type.name === "paragraph") return <p key={key}>{children}</p>;
  if (node.type.name === "heading") return <p key={key}><strong>{children}</strong></p>;
  return <div key={key}>{children}</div>;
}

/** Same F1 editor; capture is opt-in and entirely separate from the durable journal. */
export default function LiveProcessEditor(props: EditorProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [count, setCount] = useState(0);
  const [bundle, setBundle] = useState<CapturedProcess | null>(null);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  const [persistenceError, setPersistenceError] = useState("");
  const persistenceFailure = useRef("");
  const failPersistence = useCallback((code:string)=>{persistenceFailure.current=code;setPersistenceError(code);},[]);
  const [previousSegments, setPreviousSegments] = useState(0);
  const [persistedCount, setPersistedCount] = useState(0);
  const [history,setHistory]=useState<ProcessHistory|null>(null);
  const [historySegments,setHistorySegments]=useState<readonly VerifiedHistorySegment[]>([]);
  const [historySession,setHistorySession]=useState<string|null>(null);
  const [historyPosition,setHistoryPosition]=useState(0);
  const [globalCursor,setGlobalCursor]=useState(-1);
  const [objectRegistry,setObjectRegistry]=useState<AcademicObjectRegistry>({bindings:[]});
  const [registryError,setRegistryError]=useState("");
  const [claimActivity,setClaimActivity]=useState<VerifiedObjectActivity[]>([]);
  const registryDb=useRef<AcademicObjectRegistryDatabase|null>(null);
  const ledger = useRef<ProcessLedgerDatabase | null>(null);
  const previousHead = useRef<string | null>(null);
  const startedAt = useRef("");
  const persistTail = useRef<Promise<void>>(Promise.resolve());
  const capture = useRef<LocalProcessCapture | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const generation = useRef(0);
  const ready = useCallback((instance: Editor | null) => setEditor(instance), []);
  useEffect(() => () => { generation.current++; cleanup.current(); capture.current = null; ledger.current?.close(); ledger.current = null; registryDb.current?.close(); registryDb.current=null; }, []);
  useEffect(()=>{let cancelled=false;void(async()=>{const opened=await openAcademicObjectRegistry("pisac-academic-object-registry-demo");if(cancelled){if(opened.ok)opened.db.close();return;}if(!opened.ok){setRegistryError(opened.reason);return;}registryDb.current=opened.db;const loaded=await loadAcademicObjectRegistry(opened.db);if(cancelled){opened.db.close();if(registryDb.current===opened.db)registryDb.current=null;return;}if(!loaded.ok){setRegistryError(loaded.reason);return;}setObjectRegistry(loaded.registry);})().catch(()=>{if(!cancelled)setRegistryError("open-failed")});return()=>{cancelled=true;};},[]);
  useEffect(() => {
    if (!editor) return;
    let cancelled=false;
    void (async()=>{
      const opened=await openProcessLedger("pisac-process-ledger-demo");
      if(cancelled)return;
      if(!opened.ok){failPersistence("process-ledger-unavailable");return;}
      ledger.current=opened.db;
      const loaded=await loadProcessLedger(opened.db,"demo");
      for(const segment of loaded.segments)if(segment.status==="active")await markProcessInterrupted(opened.db,"demo",segment.sessionId,new Date().toISOString());
      const refreshed=await loadProcessLedger(opened.db,"demo");
      const verified=await verifyAndBuildProcessHistory(refreshed.segments,editor.schema,refreshed.invalidSessionIds);
      if(cancelled)return;
      if(verified.invalidSessionIds.length)failPersistence("process-ledger-invalid-record");
      else if(!verified.verified)failPersistence("process-ledger-chain-invalid");
      setGlobalCursor(-1);setHistorySession(null);setHistoryPosition(0);setHistory(verified.history);setHistorySegments(verified.segments);
      setPreviousSegments(verified.verified?verified.segments.length:0);
      previousHead.current=verified.verified?(verified.segments.at(-1)?.bundle.receipt.headHash??null):null;
    })().catch(()=>{if(!cancelled)failPersistence("process-ledger-open-failed")});
    return()=>{cancelled=true;};
  },[editor,failPersistence]);

  function begin() {
    if (!editor || editor.isDestroyed || !editor.isEditable) return;
    // A known durable-ledger error must not create a new segment that looks linked/healthy.
    // In-memory capture still works, but persistence stays disabled until reload/recovery.
    const persistenceAllowed=!persistenceFailure.current;
    cleanup.current();
    const version = ++generation.current;
    setBundle(null); setError(""); setCount(0); setPersistedCount(0); setPosition(0);
    try {
      const sessionId=crypto.randomUUID(); startedAt.current=new Date().toISOString();
      const session = new LocalProcessCapture(editor.state.doc, {
        documentId: "demo", sessionId,
        onChange: () => {
          if (version !== generation.current) return;
          setCount(session.count);
          if (session.error) { setError(session.error); setStatus("failed"); return; }
          const db=ledger.current;if(!db||!persistenceAllowed)return;
          const versionAtQueue=version;
          persistTail.current=persistTail.current.then(async()=>{
            if(persistenceFailure.current)return;
            const checkpoint=await session.checkpoint();
            if(versionAtQueue!==generation.current||persistenceFailure.current)return;
            await saveProcessCheckpoint(db,{bundle:checkpoint,status:"active",startedAt:startedAt.current,updatedAt:new Date().toISOString(),previousSessionHead:previousHead.current});setPersistedCount(checkpoint.events.length);
          }).catch(()=>failPersistence("process-ledger-write-failed"));
        },
      });
      capture.current = session;
      const db=ledger.current;
      if(db&&persistenceAllowed){
        persistTail.current=persistTail.current.then(async()=>{
          if(persistenceFailure.current)return;
          const checkpoint=await session.checkpoint();
          if(version!==generation.current||persistenceFailure.current)return;
          await saveProcessCheckpoint(db,{bundle:checkpoint,status:"active",startedAt:startedAt.current,updatedAt:new Date().toISOString(),previousSessionHead:previousHead.current});setPersistedCount(checkpoint.events.length);
        }).catch(()=>failPersistence("process-ledger-write-failed"));
      }
      const onTransaction = ({ transaction, appendedTransactions }: EditorEvents["transaction"]) => {
        // Tiptap applies plugin-appended transactions too; do not omit them.
        for (const tr of [transaction, ...appendedTransactions]) session.record(tr);
      };
      editor.on("transaction", onTransaction);
      cleanup.current = () => editor.off("transaction", onTransaction);
      setStatus("recording");
    } catch {
      capture.current = null; setStatus("failed"); setError("capture-unavailable");
    }
  }
  async function finish() {
    const session = capture.current;
    if (!session || !editor || editor.isDestroyed) return;
    const version = generation.current;
    cleanup.current(); cleanup.current = () => {};
    // Freeze THIS document now. Subsequent typing is outside the sealed session.
    const atStop = editor.state.doc;
    setStatus("verifying");
    try {
      const result = await session.seal(atStop);
      if (version !== generation.current) return;
      setBundle(result); setPosition(result.events.length); setCount(result.events.length); setStatus("verified-local");
      await persistTail.current;
      const db=ledger.current;
      if(db&&!persistenceFailure.current){
        try{await sealProcessSegment(db,result.documentId,result.sessionId,result,new Date().toISOString());previousHead.current=result.receipt.headHash;const loaded=await loadProcessLedger(db,result.documentId);const verified=await verifyAndBuildProcessHistory(loaded.segments,editor.schema,loaded.invalidSessionIds);if(!verified.verified)throw new Error("process-ledger-chain-invalid");setGlobalCursor(-1);setHistorySession(null);setHistoryPosition(0);setHistory(verified.history);setHistorySegments(verified.segments);setPreviousSegments(verified.segments.length);}
        catch{failPersistence("process-ledger-seal-failed");}
      }
    } catch {
      if (version !== generation.current) return;
      setError(session.error ?? "capture-verification-failed"); setStatus("failed");
    }
  }
  const replay = useMemo(() => {
    if (!bundle || !editor) return null;
    try { return replayCapturedProcess(bundle, editor.schema, position); }
    catch { return null; }
  }, [bundle, editor, position]);
  function download() {
    if (!bundle || status !== "verified-local" || !replay) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `pisac-proces-${bundle.sessionId}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const selected = bundle && position > 0 ? bundle.events[position - 1] : null;
  const selectedHistory=historySegments.find(x=>x.record.sessionId===historySession)??null;
  const historyReplay=useMemo(()=>{if(!selectedHistory||!editor)return null;try{return replayCapturedProcess(selectedHistory.bundle,editor.schema,historyPosition);}catch{return null;}},[selectedHistory,editor,historyPosition]);
  const analytics=useMemo(()=>history?.valid?buildProcessAnalytics(history.segments.map(s=>{const verified=historySegments.find(x=>x.record.sessionId===s.sessionId);if(!verified)throw new Error("verified history segment missing");return{sessionId:s.sessionId,startedAt:s.startedAt,updatedAt:s.updatedAt,eventCount:s.eventCount,status:s.status,eventElapsedMs:verified.bundle.events.map(e=>e.event.elapsedMs)}}),{idleThresholdMs:15000}):null,[history,historySegments]);
  useEffect(()=>{if(!editor||registryError||!history?.valid){setClaimActivity([]);return;}let cancelled=false;const intervals=academicObjectBindingIntervals(objectRegistry,"demo","CLAIM-014");void deriveVerifiedObjectActivity(intervals,historySegments,editor.schema).then(x=>{if(!cancelled)setClaimActivity(x)}).catch(()=>{if(!cancelled)setRegistryError("activity-verification-failed")});return()=>{cancelled=true;};},[editor,history?.valid,historySegments,objectRegistry,registryError]);
  const globalSteps=useMemo(()=>history?buildGlobalHistorySteps(history):[],[history]);
  const globalStep=globalCursor>=0?globalSteps[globalCursor]??null:null;
  const globalSegment=globalStep&&globalStep.kind!=="gap"?historySegments.find(x=>x.record.sessionId===globalStep.sessionId)??null:null;
  const globalReplay=useMemo(()=>{if(!globalStep||globalStep.kind==="gap"||!globalSegment||!editor)return null;const p=globalStep.kind==="session-start"?0:globalStep.eventIndex+1;try{return replayCapturedProcess(globalSegment.bundle,editor.schema,p);}catch{return null;}},[globalStep,globalSegment,editor]);
  function moveGlobal(direction:-1|1){const next=moveGlobalHistoryCursor(globalSteps,globalCursor,direction);if(next>=0)setGlobalCursor(next);}
  async function bindDemoClaimToSelection(){
    if(!editor||!registryDb.current||registryError)return;
    const $from=editor.state.selection.$from;let nodeId:string|null=null;
    for(let d=$from.depth;d>=0;d--){const raw:unknown=$from.node(d).attrs?.nodeId;if(typeof raw==="string"&&raw.trim()){nodeId=raw;break;}}
    if(!nodeId){setRegistryError("selection-has-no-node-id");return;}
    try{const current=currentAcademicObjectBinding(objectRegistry,"demo","CLAIM-014");if(current?.nodeId===nodeId&&current.objectRevision===4)return;await appendPersistedAcademicBinding(registryDb.current,{documentId:"demo",bindingId:crypto.randomUUID(),objectId:"CLAIM-014",objectType:"claim",objectRevision:current?.objectRevision??4,nodeId,boundAt:new Date().toISOString()});const loaded=await loadAcademicObjectRegistry(registryDb.current);if(!loaded.ok)throw new Error("invalid-registry");setObjectRegistry(loaded.registry);}
    catch{setRegistryError("binding-write-failed");}
  }

  return <>
    <DocumentEditor {...props} onReady={ready} />
    <section className="card" aria-label="Stvarni proces pisanja" data-capture-status={status} style={{ marginTop: "1rem" }}>
      <h2>Stvarni proces pisanja</h2>
      <p className="hint">Dobrovoljno bilježenje trenutnog dokumenta i svih njegovih zabilježenih izmjena, uključujući izbrisani tekst. Početni tekst je snimak, ne dokaz kako je ranije napisan.</p>
      <p className="hint">Proces se sprema u zasebni lokalni IndexedDB ledger ovog preglednika. Prekid ili reload završava taj segment kao prekinut; novi segment može se povezati na prethodnu glavu. To nije serverska potvrda ni udaljena mentorska pohrana.</p>
      <p className="hint">Bilježenje ostaje u editoru: nema praćenja drugih aplikacija ni čitanja međuspremnika izvan lijepljenja. Podudaranje zapisa nije dokaz ljudskog autorstva, identiteta ili odsutnosti vanjskog AI-ja.</p>
      <p role="status">{LABEL[status]} {error ? `(${error})` : ""}</p>{persistenceError?<p role="alert">Trajna lokalna evidencija nije potvrđena ({persistenceError}). Dokument se i dalje uređuje i sprema odvojeno.</p>:null}<p className="hint">Ranije provjerljivi lokalni segmenti ovog dokumenta: <b data-testid="persisted-segments">{previousSegments}</b></p>
      <p>Pohranjene transakcije u ovoj memorijskoj sesiji: <b data-testid="capture-count">{count}</b> · potvrđene u trajnom lokalnom checkpointu: <b data-testid="persisted-count">{persistedCount}</b></p>
      <div className="row">
        {status === "idle" ? <button className="btn" disabled={!editor} onClick={begin}>Pokreni lokalno bilježenje</button> : null}
        {status === "recording" ? <button className="btn" onClick={() => void finish()}>Završi i provjeri sesiju</button> : null}
        {status === "verified-local" ? <button className="btn" onClick={download}>Preuzmi zapis procesa</button> : null}
        {status === "verified-local" || status === "failed" ? <button className="btn" onClick={begin}>Odbaci ovaj zapis i započni novu sesiju</button> : null}
      </div>
      <div className="card" role="region" aria-label="Academic Object Registry"><h3>Academic Object Registry</h3><p className="hint">Eksplicitno povezuje akademski objekt s postojećim stabilnim nodeId-em od trenutka povezivanja nadalje. Ne pripisuje retroaktivno ranije događaje.</p><button className="btn" disabled={!editor||!!registryError} onClick={()=>void bindDemoClaimToSelection()}>Poveži CLAIM-014 s ovim odlomkom</button>{currentAcademicObjectBinding(objectRegistry,"demo","CLAIM-014")?<p data-testid="claim-binding">CLAIM-014 → {currentAcademicObjectBinding(objectRegistry,"demo","CLAIM-014")!.nodeId} · binding v{currentAcademicObjectBinding(objectRegistry,"demo","CLAIM-014")!.bindingVersion}</p>:<p className="hint">CLAIM-014 još nije povezan s dokumentnim nodeom.</p>}{registryError?<p role="alert">Registry nije potvrđen ({registryError}).</p>:null}{currentAcademicObjectBinding(objectRegistry,"demo","CLAIM-014")?<div aria-label="Verificirana aktivnost CLAIM-014"><h4>Verificirana aktivnost nakon bindinga</h4>{claimActivity.length?claimActivity.map(a=><div key={a.bindingId+":"+a.sessionId+":"+a.eventIndexes.join("-")}><p><b>Sesija {a.sessionId.slice(0,8)}</b> · binding v{objectRegistry.bindings.find(x=>x.bindingId===a.bindingId)?.bindingVersion??"?"} · eventi {a.eventIndexes.map(i=>i+1).join(", ")}</p><p>{a.beforeText||"∅"} → {a.afterText||"∅"}</p></div>):<p className="hint">Nema verificiranih događaja koji su dotaknuli povezani node nakon trenutka bindinga.</p>}</div>:null}</div>
      {history&&history.valid&&historySegments.length?<div className="card" role="region" aria-label="Povijest procesa pisanja" style={{marginTop:"1rem"}}><h3>Povijest procesa pisanja</h3>{analytics?<div className="card" aria-label="Analitika procesa pisanja"><p><b>{analytics.sessions}</b> sesija · <b>{analytics.events}</b> dokumentnih transakcija · <b>{analytics.interruptedSegments}</b> prekinutih segmenata</p><p className="hint">Trajanje zabilježenih segmenata: {Math.round(analytics.segmentDurationMs/60000)} min. Zbroj kratkih intervala između zabilježenih transakcija (≤15 s): {Math.round(analytics.activeTransactionSpanMs/1000)} s. To nije mjera ukupnog aktivnog rada ni autorstva.</p>{analytics.byRecordedDate.map(d=><p key={d.date} className="hint">{d.date}: {d.sessions} sesija · {d.events} transakcija</p>)}</div>:null}<p className="hint">Svaki segment je zasebno kriptografski provjeren. Razdoblje između segmenata prikazuje se kao prekid; nije dokaz aktivnosti ni neaktivnosti tijekom tog razdoblja.</p><div className="card" role="region" aria-label="Globalna navigacija procesa"><div className="row"><button className="btn" disabled={globalCursor<=0} onClick={()=>moveGlobal(-1)}>Prethodno</button><button className="btn" disabled={!globalSteps.length||globalCursor>=globalSteps.length-1} onClick={()=>moveGlobal(1)}>Sljedeće</button></div>{globalStep?globalStep.kind==="gap"?<div data-testid="global-gap"><b>Prekid između sesija</b><p>Nema zabilježene dokumentne transakcije za ovaj interval. Pisač ne rekonstruira niti interpolira sadržaj kroz prekid.</p></div>:<div><p className="hint">{globalStep.kind==="session-start"?"Početni snimak sesije":`Događaj ${globalStep.eventIndex+1} sesije`}</p><div className="editor-surface" data-testid="global-history-replay" style={{minHeight:"4rem"}}>{globalReplay?renderNode(globalReplay,"global-doc"):"Rekonstrukcija nije dostupna."}</div></div>:<p className="hint">Odaberi Sljedeće za početak globalne navigacije.</p>}</div>{history.timeline.map(item=>item.kind==="gap"?<div key={`gap:${item.fromSessionId}:${item.toSessionId}`} className="card"><b>Prekid između sesija</b><p className="hint">{Math.round(item.durationMs/60000)} min · {item.precededByInterruption?"prethodna sesija prekinuta":"prethodna sesija završena"}</p></div>:<button key={item.sessionId} data-session-id={item.sessionId} className="card" style={{display:"block",width:"100%",textAlign:"left"}} onClick={()=>{setHistorySession(item.sessionId);setHistoryPosition(0)}}><b>Sesija {item.sessionId.slice(0,8)}</b><p className="hint">{item.status==="interrupted"?"Prekinuta":"Završena"} · {item.eventCount} događaja · {new Date(item.startedAt).toLocaleDateString("hr-HR")}</p></button>)}{selectedHistory?<div className="card" aria-label="Replay odabrane trajne sesije"><label htmlFor="history-position">Događaj odabrane sesije: {historyPosition}/{selectedHistory.bundle.events.length}</label><input id="history-position" className="input" type="range" min={0} max={selectedHistory.bundle.events.length} value={historyPosition} onChange={e=>setHistoryPosition(Number(e.target.value))}/><div className="editor-surface" data-testid="history-replay" style={{minHeight:"4rem"}}>{historyReplay?renderNode(historyReplay,"history-doc"):"Rekonstrukcija nije dostupna."}</div></div>:null}</div>:null}
      {bundle ? <div style={{ marginTop: "1rem" }}>
        <p className="hint">Lokalni pregled procesa za mentora — nije podijeljen drugom korisniku. Provjera vrijedi za završenu sesiju, ne za kasnije izmjene dokumenta.</p>
        <label htmlFor="live-process-position">Događaj stvarne sesije: {position}/{bundle.events.length}</label>
        <input id="live-process-position" className="input" aria-label="Događaj stvarne sesije" type="range" min={0} max={bundle.events.length} value={position} onChange={event => setPosition(Number(event.target.value))} />
        <div className="editor-surface" data-testid="live-replay" style={{ minHeight: "4rem" }}>{replay ? renderNode(replay, "doc") : "Rekonstrukcija nije dostupna."}</div>
        <p className="hint">Glava lokalnog lanca: <code style={{ overflowWrap: "anywhere" }}>{bundle.receipt.headHash}</code></p>
        <p className="hint">Brojač i vrijeme mjere dokumentne transakcije, ne fizičke tipke. Izvor „editor” uključuje i nepoznato podrijetlo, diktat, automatske ispravke i programske izmjene.</p>
        {selected ? <details><summary>Izvorna transakcija #{selected.event.sequence}</summary>
          <p>{selected.event.source} · {selected.event.occurredAt} · {Math.round(selected.event.elapsedMs)} ms od početka sesije</p>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(selected.event.steps, null, 2)}</pre>
        </details> : <p className="hint">Početni snimak prije bilježenja.</p>}
      </div> : null}
    </section>
  </>;
}
