import type { AcademicObject, AcademicPath } from "../academic-graph";
import type { ForensicEvent } from "../forensics/ledger";
import { applyForensicEvent } from "../forensics/replay";

export type ReviewTextVersion = { revision: number; text: string };
export type ReviewEvidenceContext = { id: string; label: string; status: "valid" | "recheck-required" };

/** A supplied local read scope, NOT a server authorization token. */
export type ReviewProvenanceScope = {
  documentId: string;
  reviewerId: string;
  throughSequence: number;
  allowedRevisions: readonly number[];
  allowedNodeIds: readonly string[];
};
export type ReviewProvenanceSource = {
  initialText: string;
  scope: ReviewProvenanceScope;
  /** A contiguous, single-node segment, in original ledger order. */
  events: readonly ForensicEvent[];
};
export type ReviewProvenanceFrame = {
  eventId: string; sequence: number; occurredAt: string;
  kind: ForensicEvent["payload"]["kind"]; text: string;
};
export type ReviewProvenance = {
  status: "not-recorded" | "scope-denied" | "unavailable" | "unsupported-event" | "snapshot-mismatch" | "reconstructed";
  /** Text equality is not verification of hashes, timestamps, identity or authorship. */
  integrity: "not-verified";
  initialText: string | null;
  frames: readonly ReviewProvenanceFrame[];
};
export type MentorReviewContextInput = {
  documentId: string; nodeId: string; reviewerId: string;
  object: AcademicObject; before: ReviewTextVersion | null; after: ReviewTextVersion;
  evidence: readonly ReviewEvidenceContext[];
  downstreamFromObjectId: string; downstream: readonly AcademicPath[];
  provenanceSource?: ReviewProvenanceSource;
};
export type MentorReviewContextBundle = Omit<MentorReviewContextInput, "provenanceSource"> & {
  provenance: ReviewProvenance;
};

const SUPPORTED = new Set(["insert-text", "paste", "delete", "cut", "replace"]);
const revisionValid = (n: number) => Number.isSafeInteger(n) && n >= 0;
const empty = (status: ReviewProvenance["status"]): ReviewProvenance => ({
  status, integrity: "not-verified", initialText: null, frames: [],
});

function deriveProvenance(input: MentorReviewContextInput): ReviewProvenance {
  const source = input.provenanceSource;
  if (!source) return empty("not-recorded");
  const scope = source.scope;
  if (!scope || scope.documentId !== input.documentId || scope.reviewerId !== input.reviewerId ||
      !Number.isSafeInteger(scope.throughSequence) || scope.throughSequence < 0 ||
      !Array.isArray(scope.allowedRevisions) || !Array.isArray(scope.allowedNodeIds) ||
      !scope.allowedRevisions.every(revisionValid) ||
      !scope.allowedRevisions.includes(input.after.revision) ||
      (input.before !== null && !scope.allowedRevisions.includes(input.before.revision)) ||
      !scope.allowedNodeIds.includes(input.nodeId)) return empty("scope-denied");
  if (typeof source.initialText !== "string" || !Array.isArray(source.events) || !source.events.length) {
    return empty("unavailable");
  }

  // No filtering/resequencing: an omitted or unrelated event cannot become a
  // convincing "complete" reconstruction. Partial histories need an explicit
  // scoped checkpoint adapter before they can enter this single-node contract.
  let document = { nodes: [{ id: input.nodeId, text: source.initialText }] };
  const frames: ReviewProvenanceFrame[] = [];
  const snapshots = new Map<number, string>();
  const ids = new Set<string>();
  let previousSequence: number | null = null;
  let previousRevision = -1;
  for (const event of source.events) {
    if (!event || event.schemaVersion !== 1 || !event.id || ids.has(event.id) ||
        !Number.isSafeInteger(event.sequence) || event.sequence < 1 ||
        (previousSequence !== null && event.sequence !== previousSequence + 1) ||
        event.sequence > scope.throughSequence || event.documentId !== input.documentId ||
        !revisionValid(event.revision) || event.revision < previousRevision ||
        !scope.allowedRevisions.includes(event.revision) || event.revision > input.after.revision ||
        !Number.isFinite(Date.parse(event.occurredAt))) return empty("unavailable");
    const payload = event.payload;
    if (!payload || !SUPPORTED.has(payload.kind)) return empty("unsupported-event");
    if (!("nodeId" in payload) || payload.nodeId !== input.nodeId || event.actorRole !== "student") {
      return empty("unavailable");
    }
    if (((payload.kind === "paste" || payload.kind === "insert-text") && typeof payload.text !== "string") ||
        (payload.kind === "replace" && typeof payload.insertedText !== "string")) return empty("unavailable");
    try {
      document = applyForensicEvent(document, event) as typeof document;
    } catch {
      return empty("unavailable");
    }
    ids.add(event.id);
    previousSequence = event.sequence;
    previousRevision = event.revision;
    const text = document.nodes[0].text;
    snapshots.set(event.revision, text);
    frames.push({eventId:event.id,sequence:event.sequence,occurredAt:event.occurredAt,kind:payload.kind,text});
  }
  if (snapshots.get(input.after.revision) !== input.after.text ||
      (input.before !== null && snapshots.get(input.before.revision) !== input.before.text)) {
    return empty("snapshot-mismatch");
  }
  return {status:"reconstructed",integrity:"not-verified",initialText:source.initialText,frames};
}

/**
 * Text/evidence/graph inputs must already be in the caller's permitted snapshot.
 * This pure local function validates object association and derives provenance;
 * it is not RLS, authentication, a trusted clock, or cryptographic attestation.
 */
export function buildMentorReviewContext(input: MentorReviewContextInput): MentorReviewContextBundle {
  if ("provenanceScopeVerified" in input || "provenance" in input) {
    throw new Error("buildMentorReviewContext: raw events required; caller assertions are not evidence");
  }
  if (!input.documentId || !input.nodeId || !input.reviewerId || !input.object.id) {
    throw new Error("buildMentorReviewContext: invalid identity");
  }
  if (!revisionValid(input.after.revision) || input.after.revision !== input.object.revision) {
    throw new Error("buildMentorReviewContext: after revision mismatch");
  }
  if (input.before && (!revisionValid(input.before.revision) || input.before.revision >= input.after.revision)) {
    throw new Error("buildMentorReviewContext: invalid before revision");
  }
  if (input.downstreamFromObjectId !== input.object.id) {
    throw new Error("buildMentorReviewContext: downstream origin mismatch");
  }
  for (const path of input.downstream) {
    let previous = input.object.id;
    const visited = new Set([previous]);
    if (!path.links.length) throw new Error("buildMentorReviewContext: invalid downstream path");
    for (const link of path.links) {
      if (link.from !== previous || !link.to || visited.has(link.to)) {
        throw new Error("buildMentorReviewContext: invalid downstream path");
      }
      previous = link.to; visited.add(previous);
    }
    if (previous !== path.target.id) throw new Error("buildMentorReviewContext: invalid downstream path");
  }
  return structuredClone({
    documentId:input.documentId,nodeId:input.nodeId,reviewerId:input.reviewerId,
    object:input.object,before:input.before,after:input.after,evidence:input.evidence,
    downstreamFromObjectId:input.downstreamFromObjectId,downstream:input.downstream,
    provenance:deriveProvenance(input),
  });
}
