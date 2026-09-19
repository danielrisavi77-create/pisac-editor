/**
 * Canonical document → docx object tree (F1 step F1-6).
 *
 * Pure mapping, no IO: this module builds the library's in-memory `Document`
 * and stops there. Packing it into bytes and handing it to the browser is the
 * job of `@/lib/docx/export`, which is also the only place the `docx` package
 * is *dynamically* imported — this file may import it statically because
 * nothing on the initial render path imports this file.
 *
 * The mapped subset is exactly the F1 node model (dossier §5) and nothing
 * else: paragraph, heading 1-3, text runs with bold/italic. What the file
 * claims about each of those is recorded separately by `./manifest`, which is
 * the artefact an author can actually check; this module only maps.
 *
 * Deliberate non-goals in F1:
 *   - No font family is set. Word's own default (and LibreOffice's
 *     substitution for it) is the honest choice on a machine we know nothing
 *     about; hardcoding "Times New Roman" would silently become "whatever
 *     Liberation maps it to" on half the readers' machines.
 *   - No DOCX round-trip QA. Verifying that Word reads this back as the same
 *     document is WordReplica's job (dossier §11: compatibility oracle) and is
 *     out of F1 scope. Producing a well-formed file is not evidence that a
 *     reader reconstructs the same meaning from it.
 */

import {
  convertMillimetersToTwip,
  Document,
  HeadingLevel,
  Paragraph,
  TextRun,
  type IParagraphOptions,
  type IRunOptions,
} from "docx";

import type {
  CanonicalDocument,
  DocumentNode,
  HeadingLevel as CanonicalHeadingLevel,
  InlineNode,
} from "../document/schema";

/** A4 in twips, derived rather than typed out, so the numbers stay checkable. */
export const A4_WIDTH_TWIP = convertMillimetersToTwip(210);
export const A4_HEIGHT_TWIP = convertMillimetersToTwip(297);
/** A plain 25 mm frame: an academic default, not a house style. */
export const PAGE_MARGIN_TWIP = convertMillimetersToTwip(25);

/**
 * Sizes are in half-points, the unit OOXML uses. Body text is 12 pt; the
 * headings step down proportionally (18 / 15 / 13 pt) so the hierarchy is
 * visible without any of them shouting.
 */
const BODY_SIZE = 24;
const HEADING_SIZES: Record<CanonicalHeadingLevel, number> = {
  1: 36,
  2: 30,
  3: 26,
};

const CANONICAL_TO_DOCX_HEADING: Record<CanonicalHeadingLevel, (typeof HeadingLevel)[keyof typeof HeadingLevel]> =
  {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
  };

/** One canonical inline node → one docx run. Marks map one to one. */
export function serializeInline(inline: InlineNode): TextRun {
  const options: IRunOptions = {
    text: inline.text,
    // Only set when present: `bold: false` is an explicit "not bold" in OOXML,
    // which is a different statement from saying nothing at all.
    ...(inline.marks.includes("bold") ? { bold: true } : {}),
    ...(inline.marks.includes("italic") ? { italics: true } : {}),
  };
  return new TextRun(options);
}

/**
 * One canonical block → one docx paragraph.
 *
 * A block with no children becomes a paragraph with no runs, which is what an
 * empty paragraph is in OOXML — not a paragraph holding an empty string.
 */
export function serializeBlock(node: DocumentNode): Paragraph {
  const options: IParagraphOptions = {
    children: node.children.map(serializeInline),
    ...(node.type === "heading"
      ? { heading: CANONICAL_TO_DOCX_HEADING[node.level] }
      : {}),
  };
  return new Paragraph(options);
}

/** Every block of the document, in document order. */
export function serializeBlocks(doc: CanonicalDocument): Paragraph[] {
  return doc.nodes.map(serializeBlock);
}

/**
 * The whole document: one A4 section, default styles, the blocks in order.
 *
 * Returns the library's `Document`; packing it is the caller's business.
 */
export function serializeToDocx(doc: CanonicalDocument): Document {
  return new Document({
    styles: {
      default: {
        document: {
          run: { size: BODY_SIZE },
          paragraph: { spacing: { line: 360, after: 120 } },
        },
        heading1: {
          run: { size: HEADING_SIZES[1], bold: true },
          paragraph: { spacing: { before: 360, after: 180 } },
        },
        heading2: {
          run: { size: HEADING_SIZES[2], bold: true },
          paragraph: { spacing: { before: 300, after: 150 } },
        },
        heading3: {
          run: { size: HEADING_SIZES[3], bold: true },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_WIDTH_TWIP, height: A4_HEIGHT_TWIP },
            margin: {
              top: PAGE_MARGIN_TWIP,
              bottom: PAGE_MARGIN_TWIP,
              left: PAGE_MARGIN_TWIP,
              right: PAGE_MARGIN_TWIP,
            },
          },
        },
        children: serializeBlocks(doc),
      },
    ],
  });
}
