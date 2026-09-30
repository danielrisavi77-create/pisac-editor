"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Editor, EditorEvents } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import DocumentEditor, { type EditorProps } from "@/editor/Editor";
import { LocalProcessCapture, replayCapturedProcess, type CapturedProcess } from "@/editor/process-capture";
import { verifyAndBuildProcessHistory, type VerifiedHistorySegment } from "@/domain/forensics/verified-process-history";
import type { ProcessHistory } from "@/domain/forensics/process-history";
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
  const ledger = useRef<ProcessLedgerDatabase | null>(null);
  const previousHead = useRef<string | null>(null);
  const startedAt = useRef("");
  const persistTail = useRef<Promise<void>>(Promise.resolve());
  const capture = useRef<LocalProcessCapture | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const generation = useRef(0);
  const ready = useCallback((instance: Editor | null) => setEditor(instance), []);
  useEffect(() => () => { generation.current++; cleanup.current(); capture.current = null; ledger.current?.close(); ledger.current = null; }, []);
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
      const verified=await verifyAndBuildProcessHistory(refreshed.segments,editor.schema);
      if(cancelled)return;
      if(refreshed.invalidSessionIds.length)failPersistence("process-ledger-invalid-record");
      if(!verified.verified)failPersistence("process-ledger-chain-invalid");
      setHistory(verified.history);setHistorySegments(verified.segments);
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
        try{await sealProcessSegment(db,result.documentId,result.sessionId,result,new Date().toISOString());previousHead.current=result.receipt.headHash;const loaded=await loadProcessLedger(db,result.documentId);const verified=await verifyAndBuildProcessHistory(loaded.segments,editor.schema);if(!verified.verified)throw new Error("process-ledger-chain-invalid");setHistory(verified.history);setHistorySegments(verified.segments);setPreviousSegments(verified.segments.length);}
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
      {history&&history.valid&&historySegments.length?<div className="card" role="region" aria-label="Povijest procesa pisanja" style={{marginTop:"1rem"}}><h3>Povijest procesa pisanja</h3><p className="hint">Svaki segment je zasebno kriptografski provjeren. Razdoblje između segmenata prikazuje se kao prekid; nije dokaz aktivnosti ni neaktivnosti tijekom tog razdoblja.</p>{history.timeline.map(item=>item.kind==="gap"?<div key={`gap:${item.fromSessionId}:${item.toSessionId}`} className="card"><b>Prekid između sesija</b><p className="hint">{Math.round(item.durationMs/60000)} min · {item.precededByInterruption?"prethodna sesija prekinuta":"prethodna sesija završena"}</p></div>:<button key={item.sessionId} className="card" style={{display:"block",width:"100%",textAlign:"left"}} onClick={()=>{setHistorySession(item.sessionId);setHistoryPosition(0)}}><b>Sesija {item.sessionId.slice(0,8)}</b><p className="hint">{item.status==="interrupted"?"Prekinuta":"Završena"} · {item.eventCount} događaja · {new Date(item.startedAt).toLocaleDateString("hr-HR")}</p></button>)}{selectedHistory?<div className="card" aria-label="Replay odabrane trajne sesije"><label htmlFor="history-position">Događaj odabrane sesije: {historyPosition}/{selectedHistory.bundle.events.length}</label><input id="history-position" className="input" type="range" min={0} max={selectedHistory.bundle.events.length} value={historyPosition} onChange={e=>setHistoryPosition(Number(e.target.value))}/><div className="editor-surface" data-testid="history-replay" style={{minHeight:"4rem"}}>{historyReplay?renderNode(historyReplay,"history-doc"):"Rekonstrukcija nije dostupna."}</div></div>:null}</div>:null}
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
