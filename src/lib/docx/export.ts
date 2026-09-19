/**
 * Client-side DOCX export (F1 step F1-6).
 *
 * The canonical document already lives in the browser — it is what the editor
 * projects and what the journal stores — so the file is built there too. A
 * server round trip would mean exporting whatever the server last accepted,
 * which is a different document whenever the local queue is not empty, and
 * silently handing the author the older one under a button that says "download"
 * is exactly the kind of false claim the sync states exist to prevent.
 *
 * `docx` and the serializer are pulled in with a dynamic `import()` so neither
 * the library nor the mapping is part of the initial bundle: the packer is
 * several hundred kilobytes that an author who never exports should never pay
 * for.
 *
 * What this module does NOT do: verify the file. Checking that Word (or
 * LibreOffice) reconstructs the same document from these bytes is WordReplica's
 * job — a compatibility oracle, dossier §11 — and it is out of F1 scope. The
 * manifest returned here describes the MAPPING, not the round trip.
 */

import type { CanonicalDocument } from "@/domain/document";
import type { ExportManifest } from "@/domain/docx/manifest";

/** Croatian letters that have no ASCII decomposition and need naming. */
const CROATIAN_TRANSLITERATION: Record<string, string> = {
  č: "c",
  ć: "c",
  š: "s",
  ž: "z",
  đ: "d",
  Č: "c",
  Ć: "c",
  Š: "s",
  Ž: "z",
  Đ: "d",
};

/** Used when a title slugifies to nothing at all (e.g. "«»" or only spaces). */
export const FALLBACK_SLUG = "dokument";

/** Long enough for a real thesis title, short enough for every filesystem. */
const MAX_SLUG_LENGTH = 80;

/**
 * Title → filesystem-safe ASCII slug.
 *
 * Croatian diacritics are transliterated by name (č/ć → c, š → s, ž → z,
 * đ → d) rather than being stripped: "Cudoviste" is a word an author can find
 * again in their downloads folder, "udovite" is not. Everything else decomposes
 * through NFD, and anything still outside [a-z0-9] becomes a single hyphen.
 */
export function slugify(title: string): string {
  const transliterated = [...title]
    .map((char) => CROATIAN_TRANSLITERATION[char] ?? char)
    .join("");

  const slug = transliterated
    .normalize("NFD")
    // Combining marks left by the decomposition (é → e + U+0301).
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/gu, "");

  return slug.length > 0 ? slug : FALLBACK_SLUG;
}

/** `<project-title-slugified>.docx`. */
export function docxFileName(title: string): string {
  return `${slugify(title)}.docx`;
}

/**
 * Overrides for the two impure steps, so the export can be exercised without
 * a DOM. Production passes neither.
 */
export type ExportDeps = {
  /** Hands the packed file to the user. Default: an `a[download]` click. */
  saveBlob?: (blob: Blob, fileName: string) => void;
  /** Clock for the manifest. Default: `new Date()`. */
  now?: () => Date;
};

/**
 * Builds the manifest, serializes, packs and downloads the document.
 *
 * `fileName` is the PROJECT TITLE, not a finished name: it is slugified here
 * so every call site produces the same shape of file name. Returns the
 * manifest so the caller can tell the author, in one honest sentence, what the
 * file they just received does and does not carry.
 */
export async function exportDocumentToDocx(
  doc: CanonicalDocument,
  fileName: string,
  deps: ExportDeps = {},
): Promise<ExportManifest> {
  const [{ buildExportManifest }, { serializeToDocx }, { Packer }] =
    await Promise.all([
      import("@/domain/docx/manifest"),
      import("@/domain/docx/serialize"),
      import("docx"),
    ]);

  const manifest = buildExportManifest(doc, { now: deps.now });
  const blob = await Packer.toBlob(serializeToDocx(doc));

  (deps.saveBlob ?? saveBlobViaAnchor)(blob, docxFileName(fileName));

  return manifest;
}

/**
 * The plain browser download: an object URL on a detached anchor, clicked and
 * revoked. No new tab, no navigation — the editor keeps its state, and with it
 * the journal lock this tab holds.
 */
function saveBlobViaAnchor(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next frame: revoking synchronously can race the download
  // the click just started in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
