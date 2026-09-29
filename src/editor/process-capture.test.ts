import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, type Transaction } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { LocalProcessCapture, replayCapturedProcess, verifyCapturedProcess } from "./process-capture";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    heading: { group: "block", content: "text*", attrs: { level: { default: 1 } } },
    text: { group: "inline" },
  },
  marks: { bold: {}, italic: {} },
});
const hash = async (text: string) => createHash("sha256").update(text).digest("hex");
function fixture(text = "", extra: Plugin[] = []) {
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, text ? schema.text(text) : undefined)]),
    plugins: [history(), ...extra],
  });
  let elapsedMs = 0;
  const capture = new LocalProcessCapture(state.doc, {
    documentId: "demo", sessionId: "session-1", hash,
    clock: () => ({ occurredAt: "2026-09-29T12:00:00.000Z", elapsedMs: elapsedMs++ }),
  });
  const apply = (tr: Transaction) => {
    const applied = state.applyTransaction(tr);
    for (const accepted of applied.transactions) capture.record(accepted);
    state = applied.state;
  };
  return { capture, apply, state: () => state };
}

describe("Real document transaction capture", () => {
  it("starts from the existing snapshot without inventing typing events", async () => {
    const f = fixture("Uvezen tekst");
    const bundle = await f.capture.seal(f.state().doc);
    assert.equal(bundle.events.length, 0);
    assert.equal(replayCapturedProcess(bundle, schema, 0).textContent, "Uvezen tekst");
    assert.equal(await verifyCapturedProcess(bundle, schema, hash), true);
  });
  it("records exact committed text steps, including Croatian and emoji text", async () => {
    const f = fixture();
    f.apply(f.state().tr.insertText("Čćžšđ 👋"));
    const bundle = await f.capture.seal(f.state().doc);
    assert.equal(replayCapturedProcess(bundle, schema, 1).textContent, "Čćžšđ 👋");
    assert.equal(await verifyCapturedProcess(bundle, schema, hash), true);
    assert.equal(bundle.events[0].event.source, "editor");
  });
  it("distinguishes observed paste from unknown-origin editor changes", async () => {
    const f = fixture();
    f.apply(f.state().tr.insertText("Paste").setMeta("uiEvent", "paste"));
    const bundle = await f.capture.seal(f.state().doc);
    assert.equal(bundle.events[0].event.source, "paste");
  });
  it("records a composition transaction without labelling it human authorship", async () => {
    const f = fixture();
    f.apply(f.state().tr.insertText("č").setMeta("composition", 1));
    const bundle = await f.capture.seal(f.state().doc);
    assert.equal(bundle.events[0].event.source, "composition");
    assert.ok(!("humanProbability" in bundle));
  });
  it("replays deletions, marks, paragraph splits and actual undo/redo steps", async () => {
    const f = fixture("abcdef");
    f.apply(f.state().tr.delete(2, 4));
    f.apply(f.state().tr.addMark(1, 3, schema.marks.bold.create()));
    f.apply(f.state().tr.split(3));
    assert.equal(undo(f.state(), f.apply), true);
    assert.equal(redo(f.state(), f.apply), true);
    const bundle = await f.capture.seal(f.state().doc);
    assert.equal(bundle.events.length, 5);
    assert.deepEqual(replayCapturedProcess(bundle, schema, 5).toJSON(), f.state().doc.toJSON());
    assert.equal(await verifyCapturedProcess(bundle, schema, hash), true);
  });
  it("captures appended transactions rather than silently losing them", async () => {
    const appended = new Plugin({
      appendTransaction(transactions, _old, state) {
        if (transactions.some(tr => tr.getMeta("append-demo"))) return state.tr.insertText("!");
        return null;
      },
    });
    const f = fixture("", [appended]);
    f.apply(f.state().tr.insertText("A").setMeta("append-demo", true));
    const bundle = await f.capture.seal(f.state().doc);
    assert.equal(bundle.events.length, 2);
    assert.equal(replayCapturedProcess(bundle, schema, 2).textContent, "A!");
  });
  it("ignores selection-only transactions", async () => {
    const f = fixture("tekst");
    f.apply(f.state().tr.setMeta("focus", true));
    assert.equal((await f.capture.seal(f.state().doc)).events.length, 0);
  });
  it("serializes immediately so later transaction mutation cannot change evidence", async () => {
    const f = fixture();
    const tr = f.state().tr.insertText("A");
    f.apply(tr);
    tr.insertText("B");
    const bundle = await f.capture.seal(f.state().doc);
    assert.equal(replayCapturedProcess(bundle, schema, 1).textContent, "A");
  });
  it("rejects a missing transaction instead of re-starting history", async () => {
    const f = fixture();
    const other = f.state().apply(f.state().tr.insertText("unseen"));
    f.capture.record(other.tr.insertText("changed"));
    await assert.rejects(f.capture.seal(other.doc), /capture-gap/);
  });
  it("checks the actual document at stop, even if the missing change was last", async () => {
    const f = fixture();
    await assert.rejects(f.capture.seal(f.state().tr.insertText("unrecorded").doc), /capture-gap/);
  });
  it("fails visibly at the event budget without silently trimming", async () => {
    const f = fixture();
    const capture = new LocalProcessCapture(f.state().doc, { documentId: "d", sessionId: "s", hash, maxEvents: 1 });
    let state = f.state();
    const first = state.tr.insertText("A"); capture.record(first); state = state.apply(first);
    const second = state.tr.insertText("B"); capture.record(second); state = state.apply(second);
    await assert.rejects(capture.seal(state.doc), /capture-limit/);
  });
  it("bounds queued snapshots while hashing is delayed", async () => {
    const f = fixture("x".repeat(1000));
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const capture = new LocalProcessCapture(f.state().doc, { documentId: "d", sessionId: "s", maxBytes: 3000, hash: async value => { await wait; return hash(value); } });
    let state = f.state();
    for (const text of ["A", "B"]) { const tr = state.tr.insertText(text); capture.record(tr); state = state.apply(tr); }
    const sealed = capture.seal(state.doc); release();
    await assert.rejects(sealed, /capture-limit/);
  });
  it("does not let a broken UI observer abort the editor transaction", async () => {
    const f = fixture();
    const capture = new LocalProcessCapture(f.state().doc, { documentId: "d", sessionId: "s", hash, onChange: () => { throw new Error("observer"); } });
    const tr = f.state().tr.insertText("A");
    capture.record(tr);
    assert.equal((await capture.seal(tr.doc)).events.length, 1);
  });
  it("hash failures do not become a verified session", async () => {
    const f = fixture();
    const capture = new LocalProcessCapture(f.state().doc, { documentId: "d", sessionId: "s", hash: async () => { throw new Error("unavailable"); } });
    await assert.rejects(capture.seal(f.state().doc));
  });
  it("preserves sequence order while hashes are pending", async () => {
    const f = fixture();
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const capture = new LocalProcessCapture(f.state().doc, { documentId: "d", sessionId: "s", hash: async value => { await wait; return hash(value); } });
    let state = f.state();
    for (const text of ["A", "B", "C"]) { const tr = state.tr.insertText(text); capture.record(tr); state = state.apply(tr); }
    const sealed = capture.seal(state.doc); release();
    const bundle = await sealed;
    assert.deepEqual(bundle.events.map(x => x.event.sequence), [1, 2, 3]);
    assert.equal(await verifyCapturedProcess(bundle, schema, hash), true);
  });
  it("detects a changed step, removed tail, altered snapshot and receipt", async () => {
    const f = fixture();
    f.apply(f.state().tr.insertText("A")); f.apply(f.state().tr.insertText("B"));
    const original = await f.capture.seal(f.state().doc);
    const tail = structuredClone(original); tail.events.pop();
    assert.equal(await verifyCapturedProcess(tail, schema, hash), false);
    const step = structuredClone(original); step.events[0].event.steps = [];
    assert.equal(await verifyCapturedProcess(step, schema, hash), false);
    const receipt = structuredClone(original); receipt.receipt.headHash = "0".repeat(64);
    assert.equal(await verifyCapturedProcess(receipt, schema, hash), false);
    const snapshot = structuredClone(original); snapshot.initialDocument = schema.node("doc", null, [schema.node("paragraph", null, schema.text("X"))]).toJSON();
    assert.equal(await verifyCapturedProcess(snapshot, schema, hash), false);
  });
  it("requires valid replay positions rather than silently clamping", async () => {
    const f = fixture(); const b = await f.capture.seal(f.state().doc);
    assert.throws(() => replayCapturedProcess(b, schema, -1));
    assert.throws(() => replayCapturedProcess(b, schema, 1));
  });
});
