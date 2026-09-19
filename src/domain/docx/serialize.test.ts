import { describe, expect, it } from "vitest";
import type { Document, Paragraph } from "docx";

import {
  A4_HEIGHT_TWIP,
  A4_WIDTH_TWIP,
  PAGE_MARGIN_TWIP,
  serializeBlock,
  serializeBlocks,
  serializeInline,
  serializeToDocx,
} from "./serialize";
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

function doc(nodes: CanonicalDocument["nodes"]): CanonicalDocument {
  return { schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes };
}

/* ------------------------------------------------------------------ */
/* Readers over docx's own object model.                               */
/*                                                                     */
/* The library builds an OOXML element tree — every node has a         */
/* `rootKey` (`w:p`, `w:r`, `w:b`, …) and a `root` of children — so    */
/* these helpers assert on the element names Word itself reads, rather */
/* than on our own constructor arguments echoed back at us.            */
/* ------------------------------------------------------------------ */

type XmlNode = { rootKey?: string; root?: unknown };

function childrenOf(node: unknown): XmlNode[] {
  const root = (node as XmlNode | undefined)?.root;
  return Array.isArray(root) ? (root as XmlNode[]) : [];
}

function child(node: unknown, key: string): XmlNode | undefined {
  return childrenOf(node).find((candidate) => candidate?.rootKey === key);
}

/** The `w:pStyle` value, e.g. `Heading1`; `null` for body text. */
function paragraphStyle(paragraph: unknown): string | null {
  const style = child(child(paragraph, "w:pPr"), "w:pStyle");
  if (!style) {
    return null;
  }
  const attributes = childrenOf(style)[0] as
    | { root?: { val?: { value?: string } } }
    | undefined;
  return attributes?.root?.val?.value ?? null;
}

type ReadRun = { text: string; bold: boolean; italic: boolean };

function runsOf(paragraph: unknown): ReadRun[] {
  return childrenOf(paragraph)
    .filter((node) => node.rootKey === "w:r")
    .map((run) => {
      const properties = child(run, "w:rPr");
      const text = child(run, "w:t");
      return {
        text: childrenOf(text)
          .filter((part): part is XmlNode & string => typeof part === "string")
          .join(""),
        bold: child(properties, "w:b") !== undefined,
        italic: child(properties, "w:i") !== undefined,
      };
    });
}

type DocumentInternals = {
  documentWrapper: {
    document: {
      body: { root: unknown[]; sections: unknown[] };
    };
  };
};

function bodyOf(document: Document) {
  return (document as unknown as DocumentInternals).documentWrapper.document.body;
}

/**
 * The paragraphs we put in the body.
 *
 * docx adds one section-break paragraph of its own, recognisable because it
 * carries two `w:pPr` children and no runs; a genuinely empty paragraph of
 * ours has exactly one.
 */
function bodyParagraphs(document: Document): unknown[] {
  return bodyOf(document).root.filter(
    (node) =>
      childrenOf(node).filter((part) => part.rootKey === "w:pPr").length <= 1,
  );
}

/**
 * The `_attr` bag of an element. docx uses two shapes for it — a plain
 * `{ val: 24 }` and a keyed `{ width: { key: "w:w", value: 11906 } }` — so
 * `attributeValue` unwraps whichever one is there.
 */
function attributesOf(element: unknown): Record<string, unknown> {
  const attrs = childrenOf(element)[0] as
    | { root?: Record<string, unknown> }
    | undefined;
  return attrs?.root ?? {};
}

function attributeValue(element: unknown, key: string): unknown {
  const raw = attributesOf(element)[key];
  return typeof raw === "object" && raw !== null && "value" in raw
    ? (raw as { value: unknown }).value
    : raw;
}

/** Walks any element tree and yields every node carrying `rootKey`. */
function findAll(value: unknown, rootKey: string): XmlNode[] {
  const found: XmlNode[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object" || node === null) {
      return;
    }
    const record = node as Record<string, unknown>;
    if (record.rootKey === rootKey) {
      found.push(record as XmlNode);
    }
    Object.values(record).forEach(walk);
  };
  walk(value);
  return found;
}

function stylesOf(document: Document): unknown {
  return (document as unknown as { styles: unknown }).styles;
}

/** Run size (half-points) per named style id, e.g. `Heading1` → 36. */
function styleRunSizes(document: Document): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const style of findAll(stylesOf(document), "w:style")) {
    const id = attributeValue(style, "styleId");
    const size = findAll(style, "w:sz")
      .map((element) => attributeValue(element, "val"))
      .find((value) => typeof value === "number");
    if (typeof id === "string" && typeof size === "number") {
      sizes[id] = size;
    }
  }
  return sizes;
}

/** The document-wide default run size (half-points). */
function defaultRunSize(document: Document): number | undefined {
  const defaults = findAll(stylesOf(document), "w:docDefaults")[0];
  const size = findAll(defaults, "w:sz")
    .map((element) => attributeValue(element, "val"))
    .find((value) => typeof value === "number");
  return typeof size === "number" ? size : undefined;
}

/* ------------------------------------------------------------------ */

describe("serializeInline", () => {
  it("maps an unmarked text node to a bare run", () => {
    const run = runsOf({ root: [serializeInline(textNode("Tekst"))] })[0];
    // Read back through a fake paragraph: `runsOf` wants a parent element.
    expect(run).toEqual({ text: "Tekst", bold: false, italic: false });
  });

  it("maps bold and italic onto w:b and w:i", () => {
    const both = serializeInline(textNode("x", ["bold", "italic"]));
    const onlyItalic = serializeInline(textNode("y", ["italic"]));

    expect(runsOf({ root: [both] })[0]).toEqual({
      text: "x",
      bold: true,
      italic: true,
    });
    expect(runsOf({ root: [onlyItalic] })[0]).toEqual({
      text: "y",
      bold: false,
      italic: true,
    });
  });

  it("keeps the text verbatim, diacritics and all", () => {
    const run = runsOf({ root: [serializeInline(textNode("Čćšžđ — 12"))] })[0];
    expect(run.text).toBe("Čćšžđ — 12");
  });
});

describe("serializeBlock", () => {
  it("maps a paragraph to an unstyled w:p", () => {
    const paragraph = serializeBlock(paragraphNode(ID_A, [textNode("a")]));

    expect((paragraph as unknown as XmlNode).rootKey).toBe("w:p");
    expect(paragraphStyle(paragraph)).toBeNull();
    expect(runsOf(paragraph)).toHaveLength(1);
  });

  it("maps heading levels 1-3 onto Word's own heading styles", () => {
    const styles = ([1, 2, 3] as const).map((level) =>
      paragraphStyle(serializeBlock(headingNode(ID_A, level, [textNode("N")]))),
    );

    expect(styles).toEqual(["Heading1", "Heading2", "Heading3"]);
  });

  it("gives an empty block a paragraph with no runs", () => {
    const paragraph = serializeBlock(paragraphNode(ID_A, []));

    expect(runsOf(paragraph)).toEqual([]);
    expect((paragraph as unknown as XmlNode).rootKey).toBe("w:p");
  });

  it("keeps several runs in order, each with its own marks", () => {
    const paragraph = serializeBlock(
      paragraphNode(ID_A, [
        textNode("prvi "),
        textNode("drugi", ["bold"]),
        textNode(" treći", ["italic"]),
      ]),
    );

    expect(runsOf(paragraph)).toEqual([
      { text: "prvi ", bold: false, italic: false },
      { text: "drugi", bold: true, italic: false },
      { text: " treći", bold: false, italic: true },
    ]);
  });
});

describe("serializeBlocks", () => {
  it("produces one paragraph per canonical block, in order", () => {
    const paragraphs: Paragraph[] = serializeBlocks(
      doc([
        headingNode(ID_A, 1, [textNode("Naslov")]),
        paragraphNode(ID_B, [textNode("Tijelo")]),
        headingNode(ID_C, 2, [textNode("Dio")]),
      ]),
    );

    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.map(paragraphStyle)).toEqual([
      "Heading1",
      null,
      "Heading2",
    ]);
    expect(paragraphs.map((p) => runsOf(p)[0]?.text)).toEqual([
      "Naslov",
      "Tijelo",
      "Dio",
    ]);
  });
});

describe("serializeToDocx", () => {
  it("builds exactly one section", () => {
    const document = serializeToDocx(doc([paragraphNode(ID_A, [textNode("a")])]));

    expect(bodyOf(document).sections).toHaveLength(1);
  });

  it("sizes that section as A4 with a 25 mm frame", () => {
    const document = serializeToDocx(doc([paragraphNode(ID_A, [])]));
    const section = bodyOf(document).sections[0];

    const size = child(section, "w:pgSz");
    expect(attributeValue(size, "width")).toBe(A4_WIDTH_TWIP);
    expect(attributeValue(size, "height")).toBe(A4_HEIGHT_TWIP);

    const margin = child(section, "w:pgMar");
    expect(attributeValue(margin, "top")).toBe(PAGE_MARGIN_TWIP);
    expect(attributeValue(margin, "right")).toBe(PAGE_MARGIN_TWIP);
    expect(A4_WIDTH_TWIP).toBeLessThan(A4_HEIGHT_TWIP);
  });

  it("puts every block into the body, in document order", () => {
    const document = serializeToDocx(
      doc([
        headingNode(ID_A, 1, [textNode("Naslov")]),
        paragraphNode(ID_B, [textNode("Prvi odlomak")]),
        paragraphNode(ID_C, [textNode("Drugi", ["bold"])]),
      ]),
    );

    const paragraphs = bodyParagraphs(document);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs.map(paragraphStyle)).toEqual(["Heading1", null, null]);
    expect(paragraphs.flatMap(runsOf)).toEqual([
      { text: "Naslov", bold: false, italic: false },
      { text: "Prvi odlomak", bold: false, italic: false },
      { text: "Drugi", bold: true, italic: false },
    ]);
  });

  it("does not pin a font family: substitution stays the reader's business", () => {
    const document = serializeToDocx(doc([paragraphNode(ID_A, [textNode("a")])]));

    expect(findAll(stylesOf(document), "w:rFonts")).toEqual([]);
  });

  it("scales heading sizes down from 1 to 3, all above body text", () => {
    const document = serializeToDocx(doc([paragraphNode(ID_A, [])]));
    const body = defaultRunSize(document);
    const sizes = styleRunSizes(document);

    // Half-points: 12 pt body, 18 / 15 / 13 pt headings.
    expect(body).toBe(24);
    expect(sizes.Heading1).toBeGreaterThan(sizes.Heading2);
    expect(sizes.Heading2).toBeGreaterThan(sizes.Heading3);
    expect(sizes.Heading3).toBeGreaterThan(body as number);
  });

  it("is pure: two calls on the same document agree structurally", () => {
    const source = doc([
      headingNode(ID_A, 3, [textNode("N")]),
      paragraphNode(ID_B, [textNode("t", ["italic"])]),
    ]);

    const first = bodyParagraphs(serializeToDocx(source));
    const second = bodyParagraphs(serializeToDocx(source));

    expect(first.map(paragraphStyle)).toEqual(second.map(paragraphStyle));
    expect(first.flatMap(runsOf)).toEqual(second.flatMap(runsOf));
  });

  it("accepts a document of only empty paragraphs", () => {
    const document = serializeToDocx(
      doc([paragraphNode(ID_A, []), paragraphNode(ID_B, [])]),
    );

    expect(bodyParagraphs(document)).toHaveLength(2);
    expect(bodyParagraphs(document).flatMap(runsOf)).toEqual([]);
  });
});
