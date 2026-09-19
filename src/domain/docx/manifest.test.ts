import { describe, expect, it } from "vitest";

import {
  buildExportManifest,
  countNonExact,
  headingKind,
  markKind,
  type ExportManifest,
} from "./manifest";
import {
  DOCUMENT_SCHEMA_VERSION,
  headingNode,
  newNodeId,
  paragraphNode,
  textNode,
  type CanonicalDocument,
} from "../document/schema";

const ID_A = newNodeId(() => "11111111-1111-4111-8111-111111111111");
const ID_B = newNodeId(() => "22222222-2222-4222-8222-222222222222");
const ID_C = newNodeId(() => "33333333-3333-4333-8333-333333333333");

const FIXED = () => new Date("2026-09-19T10:00:00.000Z");

function doc(nodes: CanonicalDocument["nodes"]): CanonicalDocument {
  return { schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes };
}

function build(nodes: CanonicalDocument["nodes"]): ExportManifest {
  return buildExportManifest(doc(nodes), { now: FIXED });
}

/** A document carrying something the F1 model cannot express. */
function foreign(nodes: unknown[]): CanonicalDocument {
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    nodes,
  } as unknown as CanonicalDocument;
}

describe("buildExportManifest", () => {
  it("labels the whole F1 subset as exact and lists nothing", () => {
    const manifest = build([
      headingNode(ID_A, 1, [textNode("Naslov")]),
      paragraphNode(ID_B, [textNode("Tekst", ["bold", "italic"])]),
      headingNode(ID_C, 3, [textNode("Podnaslov")]),
    ]);

    expect(manifest.overallLabel).toBe("SUPPORTED_EXACT");
    expect(manifest.entries).toEqual([]);
    expect(countNonExact(manifest)).toBe(0);
  });

  it("summarises exact nodes and marks as counts, not entries", () => {
    const manifest = build([
      headingNode(ID_A, 2, [textNode("A")]),
      paragraphNode(ID_B, [textNode("b", ["bold"]), textNode("c", ["italic"])]),
    ]);

    expect(manifest.exactCounts).toEqual({
      [headingKind(2)]: 1,
      paragraph: 1,
      text: 3,
      [markKind("bold")]: 1,
      [markKind("italic")]: 1,
    });
  });

  it("stamps the schema version and an injected timestamp", () => {
    const manifest = build([paragraphNode(ID_A, [textNode("x")])]);

    expect(manifest.schemaVersion).toBe(DOCUMENT_SCHEMA_VERSION);
    expect(manifest.exportedAt).toBe("2026-09-19T10:00:00.000Z");
  });

  it("counts blocks and words per block", () => {
    const manifest = build([
      headingNode(ID_A, 1, [textNode("Dva  naslova")]),
      paragraphNode(ID_B, [textNode("tri "), textNode("riječi ovdje")]),
      paragraphNode(ID_C, []),
    ]);

    expect(manifest.totals).toEqual({ blocks: 3, words: 5 });
  });

  it("reports an unknown block type as UNKNOWN with its path", () => {
    const manifest = buildExportManifest(
      foreign([
        paragraphNode(ID_A, [textNode("ok")]),
        { type: "table", id: ID_B, children: [] },
      ]),
      { now: FIXED },
    );

    expect(manifest.entries).toEqual([
      { path: "nodes[1]", kind: "node:table", label: "UNKNOWN" },
    ]);
    expect(manifest.overallLabel).toBe("PARTIAL");
  });

  it("reports an unknown mark as UNKNOWN at the mark's own path", () => {
    const manifest = buildExportManifest(
      foreign([
        {
          type: "paragraph",
          id: ID_A,
          children: [{ type: "text", text: "x", marks: ["bold", "underline"] }],
        },
      ]),
      { now: FIXED },
    );

    expect(manifest.entries).toEqual([
      {
        path: "nodes[0].children[0].marks[1]",
        kind: markKind("underline"),
        label: "UNKNOWN",
      },
    ]);
    expect(manifest.exactCounts[markKind("bold")]).toBe(1);
  });

  it("refuses to claim a heading level it has no mapping for", () => {
    const manifest = buildExportManifest(
      foreign([{ type: "heading", id: ID_A, level: 6, children: [] }]),
      { now: FIXED },
    );

    expect(manifest.entries).toEqual([
      { path: "nodes[0]", kind: headingKind(6), label: "UNKNOWN" },
    ]);
  });

  it("reports an unknown inline node without losing the block around it", () => {
    const manifest = buildExportManifest(
      foreign([
        {
          type: "paragraph",
          id: ID_A,
          children: [
            { type: "text", text: "prije", marks: [] },
            { type: "image", src: "x.png" },
          ],
        },
      ]),
      { now: FIXED },
    );

    expect(manifest.entries).toEqual([
      { path: "nodes[0].children[1]", kind: "node:image", label: "UNKNOWN" },
    ]);
    expect(manifest.exactCounts.paragraph).toBe(1);
    expect(manifest.totals.words).toBe(1);
  });

  it("lists every non-exact thing individually, in document order", () => {
    const manifest = buildExportManifest(
      foreign([
        { type: "footnote", id: ID_A, children: [] },
        {
          type: "paragraph",
          id: ID_B,
          children: [{ type: "text", text: "x", marks: ["strike"] }],
        },
        { type: "table", id: ID_C, children: [] },
      ]),
      { now: FIXED },
    );

    expect(manifest.entries.map((entry) => entry.path)).toEqual([
      "nodes[0]",
      "nodes[1].children[0].marks[0]",
      "nodes[2]",
    ]);
  });

  it("survives malformed nodes instead of throwing", () => {
    const manifest = buildExportManifest(foreign([null, "paragraph", 7]), {
      now: FIXED,
    });

    expect(manifest.entries).toHaveLength(3);
    expect(manifest.entries.every((entry) => entry.label === "UNKNOWN")).toBe(true);
    expect(manifest.totals.blocks).toBe(3);
  });

  it("flags children and marks that are not arrays", () => {
    const manifest = buildExportManifest(
      foreign([
        { type: "paragraph", id: ID_A, children: "tekst" },
        {
          type: "paragraph",
          id: ID_B,
          children: [{ type: "text", text: "x", marks: "bold" }],
        },
      ]),
      { now: FIXED },
    );

    expect(manifest.entries).toEqual([
      { path: "nodes[0].children", kind: "children:?", label: "UNKNOWN" },
      { path: "nodes[1].children[0].marks", kind: "marks:?", label: "UNKNOWN" },
    ]);
  });

  it("is pure: the same document twice yields the same manifest", () => {
    const nodes = [paragraphNode(ID_A, [textNode("isto", ["bold"])])];
    expect(build(nodes)).toEqual(build(nodes));
  });

  it("treats an empty document (one empty paragraph) as fully exact", () => {
    const manifest = build([paragraphNode(ID_A, [])]);

    expect(manifest.overallLabel).toBe("SUPPORTED_EXACT");
    expect(manifest.totals).toEqual({ blocks: 1, words: 0 });
    expect(manifest.exactCounts).toEqual({ paragraph: 1 });
  });
});
