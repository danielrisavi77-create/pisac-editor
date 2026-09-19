import { describe, expect, it } from "vitest";

import { docxFileName, exportDocumentToDocx, FALLBACK_SLUG, slugify } from "./export";
import {
  DOCUMENT_SCHEMA_VERSION,
  headingNode,
  newNodeId,
  paragraphNode,
  textNode,
  type CanonicalDocument,
} from "@/domain/document";

const ID_A = newNodeId(() => "11111111-1111-4111-8111-111111111111");
const ID_B = newNodeId(() => "22222222-2222-4222-8222-222222222222");

function doc(nodes: CanonicalDocument["nodes"]): CanonicalDocument {
  return { schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes };
}

describe("slugify", () => {
  it("transliterates Croatian diacritics rather than dropping them", () => {
    expect(slugify("Čudovište iz đačke žurke")).toBe("cudoviste-iz-dacke-zurke");
    expect(slugify("Ćuk")).toBe("cuk");
  });

  it("lowercases and joins words with single hyphens", () => {
    expect(slugify("Moj  Diplomski   Rad")).toBe("moj-diplomski-rad");
  });

  it("strips punctuation and leading or trailing hyphens", () => {
    expect(slugify("  „Rad” — verzija 2!  ")).toBe("rad-verzija-2");
  });

  it("keeps digits", () => {
    expect(slugify("Poglavlje 3 od 12")).toBe("poglavlje-3-od-12");
  });

  it("decomposes other diacritics through NFD", () => {
    expect(slugify("Résumé über")).toBe("resume-uber");
  });

  it("falls back to a readable name when nothing survives", () => {
    expect(slugify("«»  —")).toBe(FALLBACK_SLUG);
    expect(slugify("")).toBe(FALLBACK_SLUG);
  });

  it("caps the length without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(78)} bbbbbbbbbb`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("docxFileName", () => {
  it("slugifies the project title and adds the extension", () => {
    expect(docxFileName("Čudovište iz đačke žurke")).toBe(
      "cudoviste-iz-dacke-zurke.docx",
    );
  });

  it("never produces a bare extension", () => {
    expect(docxFileName("   ")).toBe(`${FALLBACK_SLUG}.docx`);
  });
});

describe("exportDocumentToDocx", () => {
  it("hands the caller a manifest and the packed file", async () => {
    const saved: { blob: Blob; fileName: string }[] = [];

    const manifest = await exportDocumentToDocx(
      doc([
        headingNode(ID_A, 1, [textNode("Naslov")]),
        paragraphNode(ID_B, [textNode("Tekst", ["bold"])]),
      ]),
      "Moj rad",
      {
        saveBlob: (blob, fileName) => saved.push({ blob, fileName }),
        now: () => new Date("2026-09-19T10:00:00.000Z"),
      },
    );

    expect(manifest.overallLabel).toBe("SUPPORTED_EXACT");
    expect(manifest.totals).toEqual({ blocks: 2, words: 2 });
    expect(manifest.exportedAt).toBe("2026-09-19T10:00:00.000Z");
    expect(saved).toHaveLength(1);
    expect(saved[0].fileName).toBe("moj-rad.docx");
    expect(saved[0].blob.size).toBeGreaterThan(0);
  });

  it("packs a real zip container (a .docx is a zip: PK\\x03\\x04)", async () => {
    let packed: Blob | null = null;

    await exportDocumentToDocx(doc([paragraphNode(ID_A, [textNode("a")])]), "x", {
      saveBlob: (blob) => {
        packed = blob;
      },
    });

    const bytes = new Uint8Array(await (packed as unknown as Blob).arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("reports a partial export without refusing to produce the file", async () => {
    const saved: string[] = [];
    const withUnknown = {
      schemaVersion: DOCUMENT_SCHEMA_VERSION,
      nodes: [
        paragraphNode(ID_A, [textNode("ok")]),
        { type: "table", id: ID_B, children: [] },
      ],
    } as unknown as CanonicalDocument;

    const manifest = await exportDocumentToDocx(withUnknown, "Rad", {
      saveBlob: (_blob, fileName) => saved.push(fileName),
    });

    expect(manifest.overallLabel).toBe("PARTIAL");
    expect(manifest.entries).toHaveLength(1);
    expect(saved).toEqual(["rad.docx"]);
  });
});
