"use client";

/**
 * Client wrapper around the editor for one project.
 *
 * It holds the latest *candidate* projection in React state and nothing else:
 * no persistence, no sync state, no "Saved" label. F1-3a adds the local
 * durable journal and F1-3b the sync status chip; until then this view is
 * deliberately silent about durability rather than implying it.
 */

import { useCallback, useState } from "react";

import DocumentEditor from "@/editor/Editor";
import { countNodes, countWords, type CanonicalCandidate } from "@/editor/interop";
import type { CanonicalDocument } from "@/domain/document";

const statusRow = {
  display: "flex",
  flexWrap: "wrap",
  gap: "1rem",
  margin: "0.75rem 0 0",
  color: "var(--muted)",
  fontSize: "0.9rem",
} as const;

const problem = {
  border: "1px solid var(--muted)",
  borderRadius: "0.5rem",
  padding: "0.75rem 1rem",
  margin: "0.75rem 0 0",
} as const;

export type EditorClientProps = {
  initialDocument: CanonicalDocument;
};

export default function EditorClient({ initialDocument }: EditorClientProps) {
  const [candidate, setCandidate] = useState<CanonicalCandidate>({
    ok: true,
    doc: initialDocument,
  });

  const handleChange = useCallback((next: CanonicalCandidate) => {
    setCandidate(next);
  }, []);

  return (
    <div>
      <DocumentEditor initialDocument={initialDocument} onCanonicalChange={handleChange} />

      {candidate.ok ? (
        <p style={statusRow}>
          <span>Blokova: {countNodes(candidate.doc)}</span>
          <span>Riječi: {countWords(candidate.doc)}</span>
        </p>
      ) : (
        <div style={problem}>
          <p style={{ margin: 0 }}>
            Tekst sadrži oblikovanje koje ovaj uređivač još ne podržava, pa se ne može
            pretvoriti u kanonski zapis ({candidate.errors.length}{" "}
            {candidate.errors.length === 1 ? "problem" : "problema"}).
          </p>
        </div>
      )}
    </div>
  );
}
