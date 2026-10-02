import { createHash } from "node:crypto";

import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import {
  LocalProcessCapture,
  verifyCapturedProcess,
} from "@/editor/process-capture";
import { isEvidenceSegmentV2 } from "./evidence-segment-v2";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: { group: "inline" },
  },
  marks: {},
});

const legacyHash = async (canonical: string) =>
  createHash("sha256").update(canonical).digest("hex");

describe("Evidence v2 legacy compatibility", () => {
  it("keeps a newly produced v1 bundle verifiable only through the historic v1 verifier", async () => {
    let state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [schema.node("paragraph")]),
    });

    const capture = new LocalProcessCapture(state.doc, {
      documentId: "legacy-doc",
      sessionId: "legacy-session",
      hash: legacyHash,
      clock: () => ({
        occurredAt: "2026-10-02T20:00:00.000Z",
        elapsedMs: 1,
      }),
    });

    const transaction = state.tr.insertText("A");
    capture.record(transaction);
    state = state.apply(transaction);

    const bundle = await capture.seal(state.doc);

    expect(bundle.format).toBe("pisac-local-transactions-v1");
    expect(await verifyCapturedProcess(bundle, schema, legacyHash)).toBe(true);
    expect(isEvidenceSegmentV2(bundle)).toBe(false);
  });
});
