/** Local, opt-in transaction ledger. NOT a human-authorship or server attestation. */
import { Node as PMNode, type Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Step } from "@tiptap/pm/transform";
import { canonicalize, type HashFn } from "../domain/forensics/integrity";
import { sha256WebCrypto } from "../domain/forensics/crypto";

type JsonObject = Record<string, unknown>;
export type CaptureSource = "editor" | "paste" | "cut" | "drop" | "composition" | "system-replacement";
type CaptureEvent = {
  sequence: number; documentId: string; sessionId: string;
  occurredAt: string; elapsedMs: number; source: CaptureSource;
  steps: JsonObject[]; beforeHash: string; afterHash: string;
};
type Entry = { event: CaptureEvent; previousHash: string; eventHash: string };
export type CapturedProcess = {
  format: "pisac-local-transactions-v1"; schema: "pisac-f1-pm-v1";
  documentId: string; sessionId: string; initialDocument: JsonObject;
  genesisHash: string; events: Entry[];
  receipt: { eventCount: number; headHash: string; finalDocumentHash: string };
};
type Options = {
  documentId: string; sessionId: string; hash?: HashFn;
  clock?: () => { occurredAt: string; elapsedMs: number };
  maxEvents?: number; maxBytes?: number;
  onChange?: () => void;
};
const FORMAT = "pisac-local-transactions-v1" as const;
const SCHEMA = "pisac-f1-pm-v1" as const;
const SOURCES: readonly CaptureSource[] = ["editor", "paste", "cut", "drop", "composition", "system-replacement"];
const MAX_EVENTS = 5000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const copy = <T,>(value: T): T => structuredClone(value);
const bytes = (value: unknown) => new TextEncoder().encode(canonicalize(value)).byteLength;
const json = (node: PMNode): JsonObject => copy(node.toJSON() as JsonObject);
function genesis(input: Pick<CapturedProcess, "documentId" | "sessionId" | "initialDocument">) {
  return { format: FORMAT, schema: SCHEMA, ...input };
}
function source(tr: Transaction): CaptureSource {
  const ui: unknown = tr.getMeta("uiEvent");
  if (ui === "paste" || ui === "cut" || ui === "drop") return ui;
  if (tr.getMeta("composition") !== undefined) return "composition";
  if (tr.getMeta("preventUpdate") === true) return "system-replacement";
  // Includes keyboard, dictation, autocorrect, commands and history. Do not guess.
  return "editor";
}
function applySteps(doc: PMNode, steps: readonly JsonObject[]): PMNode {
  let next = doc;
  for (const step of steps) {
    const result = Step.fromJSON(doc.type.schema, step).apply(next);
    if (result.failed || !result.doc) throw new Error("capture-invalid-step");
    next = result.doc;
  }
  next.check();
  return next;
}

export class LocalProcessCapture {
  private readonly hash: HashFn;
  private readonly clock: NonNullable<Options["clock"]>;
  private readonly initialDocument: JsonObject;
  private expected: PMNode;
  private readonly entries: Entry[] = [];
  private pending: Promise<void>;
  private root = "";
  private head = "";
  private documentHash = "";
  private reserved = 0;
  private usedBytes = 0;
  private pendingBytes = 0;
  private lastElapsed = 0;
  private stopped = false;
  private failure: string | null = null;
  private sealed: CapturedProcess | null = null;

  constructor(initial: PMNode, private readonly options: Options) {
    if (!options.documentId.trim() || !options.sessionId.trim()) throw new Error("capture-identity");
    if (!Number.isSafeInteger(options.maxEvents ?? MAX_EVENTS) || (options.maxEvents ?? MAX_EVENTS) < 1 || (options.maxEvents ?? MAX_EVENTS) > MAX_EVENTS ||
        !Number.isSafeInteger(options.maxBytes ?? MAX_BYTES) || (options.maxBytes ?? MAX_BYTES) < 1 || (options.maxBytes ?? MAX_BYTES) > MAX_BYTES) throw new Error("capture-limit");
    initial.check(); this.expected = initial; this.initialDocument = json(initial);
    this.usedBytes = bytes(this.initialDocument);
    if (this.usedBytes > Math.min(MAX_DOCUMENT_BYTES, options.maxBytes ?? MAX_BYTES)) throw new Error("capture-limit");
    this.hash = options.hash ?? sha256WebCrypto;
    const start = performance.now();
    this.clock = options.clock ?? (() => ({ occurredAt: new Date().toISOString(), elapsedMs: performance.now() - start }));
    this.pending = (async () => {
      this.root = await this.hash(canonicalize(genesis({ documentId: options.documentId, sessionId: options.sessionId, initialDocument: this.initialDocument })));
      this.head = this.root;
      this.documentHash = await this.hash(canonicalize(this.initialDocument));
    })().catch(() => this.fail("capture-hash-failed"));
  }
  get count() { return this.entries.length; }
  get error() { return this.failure; }
  private notify() { try { this.options.onChange?.(); } catch { /* UI observers must not break editing or hashing. */ } }
  private fail(code: string) { this.failure ??= code; this.stopped = true; this.notify(); }

  /** Called synchronously for EACH committed root/appended transaction, before debounce. */
  record(tr: Transaction): void {
    if (this.stopped || !tr.docChanged) return;
    try {
      if (!tr.before.eq(this.expected)) throw new Error("capture-gap");
      const stamp = this.clock();
      if (!Number.isFinite(stamp.elapsedMs) || stamp.elapsedMs < this.lastElapsed || !Number.isFinite(Date.parse(stamp.occurredAt))) throw new Error("capture-clock");
      const steps = copy(tr.steps.map(step => step.toJSON() as JsonObject));
      const after = json(tr.doc);
      if (!steps.length || !applySteps(tr.before, steps).eq(tr.doc)) throw new Error("capture-invalid-step");
      const size = bytes(steps) + 512, snapshotBytes = bytes(after);
      if (this.reserved >= (this.options.maxEvents ?? MAX_EVENTS) || this.usedBytes + size + this.pendingBytes + snapshotBytes > (this.options.maxBytes ?? MAX_BYTES) || snapshotBytes > MAX_DOCUMENT_BYTES) throw new Error("capture-limit");
      const header = { sequence: ++this.reserved, documentId: this.options.documentId, sessionId: this.options.sessionId, ...stamp, source: source(tr), steps };
      this.usedBytes += size; this.pendingBytes += snapshotBytes; this.lastElapsed = stamp.elapsedMs; this.expected = tr.doc;
      // Serialize before awaiting; only one writer updates the chain head.
      this.pending = this.pending.then(async () => {
        if (this.failure) return;
        const afterHash = await this.hash(canonicalize(after));
        const event: CaptureEvent = { ...header, beforeHash: this.documentHash, afterHash };
        const previousHash = this.head;
        const eventHash = await this.hash(canonicalize({ previousHash, event }));
        this.entries.push({ event, previousHash, eventHash });
        this.head = eventHash; this.documentHash = afterHash; this.notify();
      }).catch(() => this.fail("capture-hash-failed")).finally(() => { this.pendingBytes -= snapshotBytes; });
    } catch (error) {
      this.fail(error instanceof Error && error.message.startsWith("capture-") ? error.message : "capture-invalid-transaction");
    }
  }
  /** Freezes the segment. Later typing is explicitly outside this capture. */
  async seal(actualDocument: PMNode): Promise<CapturedProcess> {
    this.stopped = true;
    if (this.sealed) return copy(this.sealed);
    if (!actualDocument.eq(this.expected)) this.fail("capture-gap");
    await this.pending;
    if (this.failure) throw new Error(this.failure);
    const bundle: CapturedProcess = {
      ...genesis({ documentId: this.options.documentId, sessionId: this.options.sessionId, initialDocument: this.initialDocument }),
      genesisHash: this.root, events: copy(this.entries),
      receipt: { eventCount: this.entries.length, headHash: this.head, finalDocumentHash: this.documentHash },
    };
    if (!(await verifyCapturedProcess(bundle, actualDocument.type.schema, this.hash))) { this.fail("capture-verification-failed"); throw new Error(this.failure!); }
    this.sealed = copy(bundle);
    return bundle;
  }
}

/** Self-consistency ONLY. A user controlling this device can rebuild the entire chain. */
export async function verifyCapturedProcess(bundle: CapturedProcess, schema: Schema, hash: HashFn = sha256WebCrypto): Promise<boolean> {
  try {
    if (bundle.format !== FORMAT || bundle.schema !== SCHEMA || !bundle.documentId || !bundle.sessionId || bundle.events.length > MAX_EVENTS || bytes(bundle) > MAX_BYTES * 2 || bundle.receipt.eventCount !== bundle.events.length) return false;
    const root = await hash(canonicalize(genesis({ documentId: bundle.documentId, sessionId: bundle.sessionId, initialDocument: bundle.initialDocument })));
    if (root !== bundle.genesisHash) return false;
    let doc = PMNode.fromJSON(schema, bundle.initialDocument); doc.check();
    let head = root, elapsed = 0;
    let documentHash = await hash(canonicalize(json(doc)));
    for (let i = 0; i < bundle.events.length; i++) {
      const entry = bundle.events[i], event = entry.event;
      if (event.sequence !== i + 1 || event.documentId !== bundle.documentId || event.sessionId !== bundle.sessionId || !event.steps.length || !SOURCES.includes(event.source) || !Number.isFinite(event.elapsedMs) || event.elapsedMs < elapsed || !Number.isFinite(Date.parse(event.occurredAt)) || entry.previousHash !== head || event.beforeHash !== documentHash) return false;
      if (entry.eventHash !== await hash(canonicalize({ previousHash: head, event }))) return false;
      doc = applySteps(doc, event.steps); documentHash = await hash(canonicalize(json(doc)));
      if (documentHash !== event.afterHash) return false;
      head = entry.eventHash; elapsed = event.elapsedMs;
    }
    return bundle.receipt.headHash === head && bundle.receipt.finalDocumentHash === documentHash;
  } catch { return false; }
}

/** Pure replay; this function does not mint an integrity/authorization claim. */
export function replayCapturedProcess(bundle: CapturedProcess, schema: Schema, through: number): PMNode {
  if (!Number.isSafeInteger(through) || through < 0 || through > bundle.events.length) throw new Error("capture-replay-range");
  let doc = PMNode.fromJSON(schema, bundle.initialDocument); doc.check();
  for (let i = 0; i < through; i++) {
    const event = bundle.events[i].event;
    if (event.sequence !== i + 1 || event.documentId !== bundle.documentId || event.sessionId !== bundle.sessionId) throw new Error("capture-replay-gap");
    doc = applySteps(doc, bundle.events[i].event.steps);
  }
  return doc;
}
