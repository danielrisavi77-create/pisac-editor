import { describe, expect, it } from "vitest";

import {
  EXPORT_FIDELITY_FULL,
  EXPORT_LOCAL_CHANGES_NOTE,
  exportFidelitySentence,
  exportSummaryMessage,
} from "./labels";
import { buildExportManifest } from "./manifest";
import {
  DOCUMENT_SCHEMA_VERSION,
  newNodeId,
  paragraphNode,
  textNode,
  type CanonicalDocument,
} from "../document/schema";

const ID_A = newNodeId(() => "11111111-1111-4111-8111-111111111111");
const ID_B = newNodeId(() => "22222222-2222-4222-8222-222222222222");

const exact = buildExportManifest({
  schemaVersion: DOCUMENT_SCHEMA_VERSION,
  nodes: [paragraphNode(ID_A, [textNode("a", ["bold"])])],
});

const partial = buildExportManifest({
  schemaVersion: DOCUMENT_SCHEMA_VERSION,
  nodes: [
    paragraphNode(ID_A, [textNode("a")]),
    { type: "table", id: ID_B, children: [] },
  ],
} as unknown as CanonicalDocument);

const partialTwo = buildExportManifest({
  schemaVersion: DOCUMENT_SCHEMA_VERSION,
  nodes: [
    { type: "table", id: ID_A, children: [] },
    { type: "table", id: ID_B, children: [] },
  ],
} as unknown as CanonicalDocument);

describe("exportFidelitySentence", () => {
  it("claims full fidelity only when nothing was non-exact", () => {
    expect(exportFidelitySentence(exact)).toBe(EXPORT_FIDELITY_FULL);
  });

  it("names how many parts are approximate or unknown", () => {
    expect(exportFidelitySentence(partial)).toBe(
      "Izvezeno. 1 dio je približan ili nepoznat.",
    );
    expect(exportFidelitySentence(partial)).toContain("1");
  });

  it("agrees with the count in Croatian rather than bracketing a number", () => {
    expect(exportFidelitySentence(partialTwo)).toBe(
      "Izvezeno. 2 dijela su približna ili nepoznata.",
    );
  });

  it("never states a percentage or a score", () => {
    expect(exportFidelitySentence(partial)).not.toMatch(/%/u);
    expect(exportFidelitySentence(exact)).not.toMatch(/%/u);
  });
});

describe("exportSummaryMessage", () => {
  it("adds the local-changes note when the file is not the server's version", () => {
    expect(exportSummaryMessage(exact, true)).toBe(
      `${EXPORT_FIDELITY_FULL} ${EXPORT_LOCAL_CHANGES_NOTE}`,
    );
  });

  it("leaves the note out when there is nothing local to warn about", () => {
    expect(exportSummaryMessage(exact, false)).toBe(EXPORT_FIDELITY_FULL);
  });

  it("never says the export is 'saved' or equal to the server version", () => {
    const both = exportSummaryMessage(partial, true);
    expect(both).not.toMatch(/spremljeno/iu);
    expect(both).toContain(EXPORT_LOCAL_CHANGES_NOTE);
  });
});
