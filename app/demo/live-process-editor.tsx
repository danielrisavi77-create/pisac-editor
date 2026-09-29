"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Editor, EditorEvents } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import DocumentEditor, { type EditorProps } from "@/editor/Editor";
import { LocalProcessCapture, replayCapturedProcess, type CapturedProcess } from "@/editor/process-capture";

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
  const capture = useRef<LocalProcessCapture | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const generation = useRef(0);
  const ready = useCallback((instance: Editor | null) => setEditor(instance), []);
  useEffect(() => () => { generation.current++; cleanup.current(); capture.current = null; }, []);

  function begin() {
    if (!editor || editor.isDestroyed || !editor.isEditable) return;
    cleanup.current();
    const version = ++generation.current;
    setBundle(null); setError(""); setCount(0); setPosition(0);
    try {
      const session = new LocalProcessCapture(editor.state.doc, {
        documentId: "demo", sessionId: crypto.randomUUID(),
        onChange: () => {
          if (version !== generation.current) return;
          setCount(session.count);
          if (session.error) { setError(session.error); setStatus("failed"); }
        },
      });
      capture.current = session;
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

  return <>
    <DocumentEditor {...props} onReady={ready} />
    <section className="card" aria-label="Stvarni proces pisanja" data-capture-status={status} style={{ marginTop: "1rem" }}>
      <h2>Stvarni proces pisanja</h2>
      <p className="hint">Dobrovoljno bilježenje trenutnog dokumenta i svih njegovih zabilježenih izmjena, uključujući izbrisani tekst. Početni tekst je snimak, ne dokaz kako je ranije napisan.</p>
      <p className="hint">Zapis je samo u memoriji ove stranice. Zatvaranje ili osvježavanje stranice briše ovaj zapis; preuzmi ga prije izlaska. Spremanje samog dokumenta radi odvojeno.</p>
      <p className="hint">Bilježenje ostaje u editoru: nema praćenja drugih aplikacija ni čitanja međuspremnika izvan lijepljenja. Podudaranje zapisa nije dokaz ljudskog autorstva, identiteta ili odsutnosti vanjskog AI-ja.</p>
      <p role="status">{LABEL[status]} {error ? `(${error})` : ""}</p>
      <p>Pohranjene transakcije u ovoj memorijskoj sesiji: <b data-testid="capture-count">{count}</b></p>
      <div className="row">
        {status === "idle" ? <button className="btn" disabled={!editor} onClick={begin}>Pokreni lokalno bilježenje</button> : null}
        {status === "recording" ? <button className="btn" onClick={() => void finish()}>Završi i provjeri sesiju</button> : null}
        {status === "verified-local" ? <button className="btn" onClick={download}>Preuzmi zapis procesa</button> : null}
        {status === "verified-local" || status === "failed" ? <button className="btn" onClick={begin}>Odbaci ovaj zapis i započni novu sesiju</button> : null}
      </div>
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
