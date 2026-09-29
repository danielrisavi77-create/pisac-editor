import { describe, it } from "vitest";
import * as assert from "node:assert/strict";
import { buildMentorReviewContext } from "./review-context";

describe("Mentor review context trust boundary", () => {
  it("does not accept caller-written provenance just because a boolean is true", () => {
    const forged = {
      object: { id: "C1", type: "claim", label: "Tvrdnja", revision: 4 },
      before: { revision: 3, text: "Rezultati pokazuju povezanost." },
      after: { revision: 4, text: "Rezultati dokazuju povezanost." },
      evidence: [], downstreamFromObjectId: "C1", downstream: [],
      provenanceScopeVerified: true,
      provenance: [{ id: "invented", kind: "manual-writing", startedAt: "2026-09-29T09:00:00Z", endedAt: "2026-09-29T09:00:01Z", sourceEventIds: ["does-not-exist"], summary: "Izmišljeni dokaz", metrics: { characters: 999 } }],
    };
    assert.throws(() => buildMentorReviewContext(forged as never), /raw events required/);
  });
});

import type { MentorReviewContextInput } from "./review-context";
import type { ForensicEvent } from "../forensics/ledger";
const BEFORE = "Rezultati pokazuju povezanost.";
const AFTER = "Rezultati dokazuju povezanost.";
function event(sequence: number, revision: number, payload: ForensicEvent["payload"]): ForensicEvent {
  return { schemaVersion: 1, id: `claim-event-${sequence}`, documentId: "doc-1", sequence, revision,
    occurredAt: new Date(Date.UTC(2026, 8, 29, 9, 0, sequence)).toISOString(),
    actorId: "student", actorRole: "student", payload };
}
function fixture(): MentorReviewContextInput {
  const start = BEFORE.indexOf("pokazuju");
  return {
    documentId: "doc-1", nodeId: "claim-node", reviewerId: "mentor",
    object: { id: "C1", type: "claim", label: "Tvrdnja", revision: 4 },
    before: { revision: 3, text: BEFORE }, after: { revision: 4, text: AFTER },
    evidence: [{ id: "EB1", label: "Demonstracijski izvor", status: "recheck-required" }],
    downstreamFromObjectId: "C1", downstream: [{target: {id:"S5",type:"section",label:"Rasprava",revision:4},links:[{id:"link-1",from:"C1",to:"S5",relation:"appears-in"}]}],
    provenanceSource: {
      initialText: "",
      scope: { documentId: "doc-1", reviewerId: "mentor", throughSequence: 2,
        allowedRevisions: [3, 4], allowedNodeIds: ["claim-node"] },
      events: [event(1, 3, {kind:"paste",nodeId:"claim-node",offset:0,text:BEFORE}),
        event(2, 4, {kind:"replace",nodeId:"claim-node",start,end:start+"pokazuju".length,removedTextHash:"demo-not-verified",insertedText:"dokazuju"})],
    },
  };
}

describe("Review context reconstructs only the supplied object segment", () => {
  it("derives exact frames and source IDs from the raw events", () => {
    const result = buildMentorReviewContext(fixture());
    assert.equal(result.provenance.status, "reconstructed");
    assert.equal(result.provenance.integrity, "not-verified");
    assert.deepEqual(result.provenance.frames.map(f=>[f.eventId,f.text]), [["claim-event-1",BEFORE],["claim-event-2",AFTER]]);
  });
  it("has no invented provenance when no source was supplied", () => {
    const x=fixture(); delete x.provenanceSource;
    assert.equal(buildMentorReviewContext(x).provenance.status,"not-recorded");
    assert.equal(buildMentorReviewContext(x).provenance.frames.length,0);
  });
  it("rejects an after revision belonging to a different object version", () => {
    const x=fixture(); x.after.revision=5;
    assert.throws(()=>buildMentorReviewContext(x),/after revision mismatch/);
  });
  it("rejects a same or newer before revision", () => {
    const x=fixture(); x.before!.revision=4;
    assert.throws(()=>buildMentorReviewContext(x),/invalid before revision/);
  });
  it("validates the actual impact path rather than a caller-written origin label", () => {
    const x=fixture(); x.downstream=[{...x.downstream[0],links:[{id:"unrelated",from:"OTHER",to:"S5",relation:"affects"} as never]}];
    assert.throws(()=>buildMentorReviewContext(x),/invalid downstream path/);
  });
  it("rejects an impact path ending at the wrong target", () => {
    const x=fixture(); x.downstream=[{...x.downstream[0],target:{...x.downstream[0].target,id:"OTHER"}}];
    assert.throws(()=>buildMentorReviewContext(x),/invalid downstream path/);
  });
  it("denies a scope for another reviewer", () => {
    const x=fixture(); x.provenanceSource!.scope.reviewerId="other";
    const r=buildMentorReviewContext(x).provenance;
    assert.equal(r.status,"scope-denied"); assert.equal(r.frames.length,0);
  });
  it("denies a scope for another document", () => {
    const x=fixture(); x.provenanceSource!.scope.documentId="other";
    assert.equal(buildMentorReviewContext(x).provenance.status,"scope-denied");
  });
  it("does not expose an unshared current revision", () => {
    const x=fixture(); x.provenanceSource!.scope.allowedRevisions=[3];
    assert.equal(buildMentorReviewContext(x).provenance.status,"scope-denied");
  });
  it("does not accept an unshared node", () => {
    const x=fixture(); x.provenanceSource!.scope.allowedNodeIds=[];
    assert.equal(buildMentorReviewContext(x).provenance.status,"scope-denied");
  });
  it("does not return later raw events beyond the shared boundary", () => {
    const x=fixture(); x.provenanceSource!.scope.throughSequence=1;
    const r=buildMentorReviewContext(x).provenance;
    assert.equal(r.status,"unavailable"); assert.deepEqual(r.frames,[]);
  });
  it("does not attach another document's events to this claim", () => {
    const x=fixture(); x.provenanceSource!.events=x.provenanceSource!.events.map(e=>({...e,documentId:"other"}));
    assert.equal(buildMentorReviewContext(x).provenance.status,"unavailable");
  });
  it("does not attach an unrelated node even when text happens to be identical", () => {
    const x=fixture(); x.provenanceSource!.events=x.provenanceSource!.events.map(e=>({...e,payload:{...e.payload,nodeId:"other"} as ForensicEvent["payload"]}));
    assert.equal(buildMentorReviewContext(x).provenance.status,"unavailable");
  });
  it("rejects a supplied event order with gaps", () => {
    const x=fixture(); x.provenanceSource!.scope.throughSequence=3; x.provenanceSource!.events=[x.provenanceSource!.events[0],{...x.provenanceSource!.events[1],sequence:3}];
    assert.equal(buildMentorReviewContext(x).provenance.status,"unavailable");
  });
  it("does not silently repair reversed event order", () => {
    const x=fixture(); x.provenanceSource!.events=[...x.provenanceSource!.events].reverse();
    assert.equal(buildMentorReviewContext(x).provenance.status,"unavailable");
  });
  it("does not treat unsupported undo as an unchanged successful replay", () => {
    const x=fixture(); x.provenanceSource!.events=[x.provenanceSource!.events[0],event(2,4,{kind:"undo",transactionId:"unresolved"})];
    assert.equal(buildMentorReviewContext(x).provenance.status,"unsupported-event");
  });
  it("does not invent a match when replay produces a different after text", () => {
    const x=fixture(); x.after.text="Neki drugi tekst.";
    const r=buildMentorReviewContext(x).provenance;
    assert.equal(r.status,"snapshot-mismatch"); assert.deepEqual(r.frames,[]);
  });
  it("checks the before snapshot as well as the final snapshot", () => {
    const x=fixture(); x.before!.text="Drugi pregledani tekst.";
    assert.equal(buildMentorReviewContext(x).provenance.status,"snapshot-mismatch");
  });
  it("fails closed on out-of-bounds mutations", () => {
    const x=fixture(); x.provenanceSource!.events=[event(1,3,{kind:"paste",nodeId:"claim-node",offset:99,text:BEFORE})];
    assert.equal(buildMentorReviewContext(x).provenance.status,"unavailable");
  });
  it("does not share mutable result frames with the input", () => {
    const x=fixture(); const r=buildMentorReviewContext(x);
    x.after.text="Changed outside"; x.provenanceSource!.events[0].id="changed-id";
    assert.equal(r.after.text,AFTER); assert.equal(r.provenance.frames[0].eventId,"claim-event-1");
  });
});
