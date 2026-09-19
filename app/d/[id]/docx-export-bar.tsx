"use client";

/**
 * "Preuzmi DOCX" (F1-6): the export button and the one honest sentence that
 * follows it.
 *
 * Three rules shape it:
 *
 *   1. It exports what the AUTHOR IS LOOKING AT — the newest canonical
 *      candidate the editor produced, falling back to the document this view
 *      was mounted with (journal snapshot, or the server's) when no candidate
 *      exists yet. Exporting the server's copy instead would hand the author
 *      an older document under a button that says "download".
 *   2. The summary states fidelity from the manifest, with a count and never a
 *      percentage; see `@/domain/docx/labels`.
 *   3. It never implies the file equals the server's version. Whenever the
 *      local queue is not demonstrably empty, or the state is not SYNCED, the
 *      sentence says the export contains local changes.
 *
 * Out of F1 scope, deliberately: DOCX round-trip QA. Whether Word rebuilds the
 * same document from these bytes is WordReplica's question (dossier §11), and
 * nothing here is evidence about it.
 */

import { useState } from "react";

import type { CanonicalDocument } from "@/domain/document";
import { exportSummaryMessage } from "@/domain/docx/labels";

const bar = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.6rem",
  margin: "1.25rem 0 0",
} as const;

const button = {
  padding: "0.5rem 0.9rem",
  borderRadius: "0.4rem",
  border: "1px solid var(--fg)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
} as const;

const busyButton = {
  ...button,
  borderColor: "var(--muted)",
  color: "var(--muted)",
  cursor: "progress",
} as const;

const message = {
  margin: "0.6rem 0 0",
  lineHeight: 1.5,
} as const;

/** Shown when the file could not be built at all. Never a half-claim. */
const EXPORT_FAILED_MESSAGE =
  "Izvoz nije uspio. Dokument nije preuzet. Pokušaj ponovno.";

export type DocxExportBarProps = {
  /** The document to export: the newest candidate the author can see. */
  document: CanonicalDocument;
  /** Project title; the file name is slugified from it. */
  title: string;
  /**
   * True when the exported text is not provably what the server holds —
   * pending queue non-empty, or state not SYNCED. Asynchronous because
   * reading the queue is.
   */
  hasLocalOnlyChanges: () => Promise<boolean>;
};

export default function DocxExportBar({
  document,
  title,
  hasLocalOnlyChanges,
}: DocxExportBarProps) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function exportDocx(): Promise<void> {
    if (busy) {
      return;
    }
    setSummary(null);
    setBusy(true);
    try {
      // Dynamic import: the packer is not part of the initial bundle, and an
      // author who never exports never downloads it.
      const { exportDocumentToDocx } = await import("@/lib/docx/export");
      const manifest = await exportDocumentToDocx(document, title);
      // Read AFTER the export, so the sentence describes the queue as it was
      // when the bytes were built, not as it was when the page rendered.
      const local = await hasLocalOnlyChanges();
      setSummary(exportSummaryMessage(manifest, local));
    } catch {
      setSummary(EXPORT_FAILED_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Izvoz" data-docx-export="">
      <div style={bar}>
        <button
          type="button"
          style={busy ? busyButton : button}
          disabled={busy}
          onClick={() => void exportDocx()}
        >
          Preuzmi DOCX
        </button>
      </div>
      {summary === null ? null : (
        <p style={message} data-docx-export-summary="">
          {summary}
        </p>
      )}
    </section>
  );
}
