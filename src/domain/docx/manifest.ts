/**
 * Export fidelity manifest (F1 step F1-6).
 *
 * Pure domain: no docx library, no DOM, no IO. The manifest is the honest
 * half of "we can export": it says, per node and per mark, what the .docx
 * actually carries — because a file that downloads is not the same claim as a
 * file that means what the canonical document means (dossier: deployment
 * success ≠ semantic correctness).
 *
 * The dossier's fidelity vocabulary (§11) is larger than this:
 *
 *   SUPPORTED_EXACT / PRESERVED_EXACT / SEMANTIC_EQUIVALENT /
 *   LAYOUT_EQUIVALENT / APPROXIMATED / LOSSY / UNKNOWN / BLOCKED
 *
 * F1 uses three of them and no more. Labels we cannot yet justify are not
 * minted here: claiming SEMANTIC_EQUIVALENT would require a comparator we do
 * not have in F1, and the honest answer for anything outside the F1 subset is
 * UNKNOWN. `APPROXIMATED` is part of the type from the start because it is the
 * label the first non-exact mapping will need, and widening a union later is a
 * worse migration than reserving it now; nothing in F1 emits it.
 *
 * The walk is deliberately defensive. The canonical model only has paragraph,
 * heading 1-3, text and the bold/italic marks — but a manifest whose only
 * answer for something it has never seen is to crash (or, worse, to ignore it)
 * would turn a future schema addition into a silent loss of the author's text.
 * So every node and mark is inspected as unknown data and anything unrecognised
 * is reported as UNKNOWN with the path where it sits.
 */

import {
  DOCUMENT_SCHEMA_VERSION,
  type CanonicalDocument,
} from "../document/schema";

/**
 * The three fidelity labels F1 is allowed to use.
 *
 * SUPPORTED_EXACT — the .docx carries exactly what the canonical node means.
 * APPROXIMATED    — mapped to something close, and the difference is known.
 * UNKNOWN         — outside the F1 subset; we do not claim to know what the
 *                   exported file does with it.
 */
export type FidelityLabel = "SUPPORTED_EXACT" | "APPROXIMATED" | "UNKNOWN";

/**
 * The document-level verdict. Only two values: either every single node and
 * mark was exact, or the export was partial. There is deliberately no
 * percentage and no score — a number would invite the reading that 97% is
 * nearly true, when the only question an author can act on is which parts.
 */
export type OverallFidelityLabel = "SUPPORTED_EXACT" | "PARTIAL";

/** One thing the export could not claim exactness for. */
export type ManifestEntry = {
  /** Where it sits, e.g. `nodes[3].children[1].marks[0]`. */
  path: string;
  /** What it is, in the manifest's own vocabulary, e.g. `mark:underline`. */
  kind: string;
  /** Never SUPPORTED_EXACT: exact things are counted, not listed. */
  label: Exclude<FidelityLabel, "SUPPORTED_EXACT">;
};

export type ExportManifest = {
  /** ISO 8601, UTC. When this manifest was built, not when the file landed. */
  exportedAt: string;
  /** The canonical schema the manifest was built against. */
  schemaVersion: number;
  totals: {
    /** Block nodes in the document, including ones we could not classify. */
    blocks: number;
    /** Whitespace-separated words, counted per block. A reading aid only. */
    words: number;
  };
  /**
   * How many things were exact, per kind. Exact nodes are summarised rather
   * than listed: a 400-paragraph thesis would otherwise produce a manifest
   * that nobody reads, and the entries that matter are the other ones.
   */
  exactCounts: Record<string, number>;
  /** Every non-exact node and mark, individually, in document order. */
  entries: ManifestEntry[];
  overallLabel: OverallFidelityLabel;
};

export type BuildManifestOptions = {
  /** Injected so tests (and any future replay tooling) stay deterministic. */
  now?: () => Date;
};

/** Kind strings for the F1 subset, so tests and UI agree on the vocabulary. */
export const KIND_PARAGRAPH = "paragraph";
export const KIND_TEXT = "text";
export function headingKind(level: number | string): string {
  return `heading:${level}`;
}
export function markKind(mark: string): string {
  return `mark:${mark}`;
}

/** The node types the F1 DOCX serializer maps exactly. */
const EXACT_HEADING_LEVELS = new Set([1, 2, 3]);
/** The marks the F1 DOCX serializer maps exactly. */
const EXACT_MARKS = new Set(["bold", "italic"]);

/**
 * Classifies every node and mark of `doc` and summarises the result.
 *
 * Pure: the only impurity, the timestamp, is injectable.
 */
export function buildExportManifest(
  doc: CanonicalDocument,
  options: BuildManifestOptions = {},
): ExportManifest {
  const now = options.now ?? (() => new Date());

  const entries: ManifestEntry[] = [];
  const exactCounts: Record<string, number> = {};

  const countExact = (kind: string): void => {
    exactCounts[kind] = (exactCounts[kind] ?? 0) + 1;
  };
  const addEntry = (
    path: string,
    kind: string,
    label: ManifestEntry["label"],
  ): void => {
    entries.push({ path, kind, label });
  };

  const nodes = Array.isArray(doc?.nodes) ? doc.nodes : [];
  let words = 0;

  nodes.forEach((rawNode, index) => {
    const path = `nodes[${index}]`;
    const node = asRecord(rawNode);

    if (node === null) {
      addEntry(path, "node:?", "UNKNOWN");
      return;
    }

    const type = node.type;

    if (type === "paragraph") {
      countExact(KIND_PARAGRAPH);
    } else if (type === "heading") {
      const level = node.level;
      if (typeof level === "number" && EXACT_HEADING_LEVELS.has(level)) {
        countExact(headingKind(level));
      } else {
        // A heading we have no style for. Not "approximately a heading":
        // we do not know what level it is, so we do not know what the file
        // will say.
        addEntry(path, headingKind(String(level)), "UNKNOWN");
      }
    } else {
      addEntry(path, `node:${describe(type)}`, "UNKNOWN");
    }

    words += classifyChildren(node.children, path, countExact, addEntry);
  });

  return {
    exportedAt: now().toISOString(),
    schemaVersion:
      typeof doc?.schemaVersion === "number"
        ? doc.schemaVersion
        : DOCUMENT_SCHEMA_VERSION,
    totals: { blocks: nodes.length, words },
    exactCounts,
    entries,
    overallLabel: entries.length === 0 ? "SUPPORTED_EXACT" : "PARTIAL",
  };
}

/** How many non-exact entries the manifest holds. Convenience for the UI. */
export function countNonExact(manifest: ExportManifest): number {
  return manifest.entries.length;
}

/**
 * Classifies a block's inline children and returns the words they contribute.
 *
 * Word counting lives here rather than being imported from the editor interop
 * layer because this walk must survive children that are not text nodes at
 * all; a counter that assumes `child.text` is a string would throw on exactly
 * the input this function exists to describe.
 */
function classifyChildren(
  rawChildren: unknown,
  parentPath: string,
  countExact: (kind: string) => void,
  addEntry: (path: string, kind: string, label: ManifestEntry["label"]) => void,
): number {
  if (!Array.isArray(rawChildren)) {
    if (rawChildren !== undefined) {
      addEntry(`${parentPath}.children`, "children:?", "UNKNOWN");
    }
    return 0;
  }

  let text = "";

  rawChildren.forEach((rawChild, index) => {
    const path = `${parentPath}.children[${index}]`;
    const child = asRecord(rawChild);

    if (child === null) {
      addEntry(path, "node:?", "UNKNOWN");
      return;
    }

    if (child.type === "text") {
      countExact(KIND_TEXT);
      if (typeof child.text === "string") {
        text += child.text;
      }
    } else {
      addEntry(path, `node:${describe(child.type)}`, "UNKNOWN");
    }

    classifyMarks(child.marks, path, countExact, addEntry);
  });

  return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

function classifyMarks(
  rawMarks: unknown,
  parentPath: string,
  countExact: (kind: string) => void,
  addEntry: (path: string, kind: string, label: ManifestEntry["label"]) => void,
): void {
  if (rawMarks === undefined) {
    return;
  }
  if (!Array.isArray(rawMarks)) {
    addEntry(`${parentPath}.marks`, "marks:?", "UNKNOWN");
    return;
  }

  rawMarks.forEach((mark, index) => {
    const path = `${parentPath}.marks[${index}]`;
    if (typeof mark === "string" && EXACT_MARKS.has(mark)) {
      countExact(markKind(mark));
      return;
    }
    addEntry(path, markKind(describe(mark)), "UNKNOWN");
  });
}

/** `null` for anything that is not a plain object we can read fields off. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** A short, safe name for an unrecognised type, for the manifest's `kind`. */
function describe(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 0 ? value : "?";
  }
  return value === undefined || value === null ? "?" : typeof value;
}
