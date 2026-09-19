"use client";

/**
 * Client wrapper around the editor for one project.
 *
 * F1-3a adds the local durable journal: every canonical candidate the editor
 * produces is written to IndexedDB in one atomic transaction, and the sync
 * state machine (`syncReducer`) is driven from the result. There is still no
 * server sync — that is F1-4 — so this view can reach LOCAL_DURABLE and never
 * SYNCED, and it says so rather than implying a generic "saved".
 *
 * On mount the journal is read first: a snapshot found there wins over the
 * empty document handed down by the server page, because it is the author's
 * most recent durable text. The real server document arrives in F1-4.
 *
 * The status chip is F1-3b. Until then the raw state constant is exposed in
 * `data-sync-state` (for the E2E fixtures) plus one unobtrusive text node; the
 * Croatian labels come with the chip.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import DocumentEditor from "@/editor/Editor";
import { countNodes, countWords, type CanonicalCandidate } from "@/editor/interop";
import type { CanonicalDocument } from "@/domain/document";
import {
  INITIAL_SYNC_STATE,
  syncReducer,
  type LocalSaveFailureReason,
} from "@/domain/sync";
import { openJournal, type JournalDatabase } from "@/lib/journal/db";
import { loadJournal, saveLocal } from "@/lib/journal/journal";

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
  documentId: string;
  initialDocument: CanonicalDocument;
};

type Bootstrap = {
  /** What the editor starts from: the journal snapshot, or the page's document. */
  document: CanonicalDocument;
  /** The revision that document is based on. Only a server ACK advances it. */
  baseRevision: number;
};

export default function EditorClient({
  documentId,
  initialDocument,
}: EditorClientProps) {
  const [syncState, dispatch] = useReducer(syncReducer, INITIAL_SYNC_STATE);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [candidate, setCandidate] = useState<CanonicalCandidate | null>(null);

  const dbRef = useRef<JournalDatabase | null>(null);
  const baseRevision = useRef(0);
  // The page's document is only the fallback, and it is read once: keeping it
  // in a ref stops a new object identity from re-running the bootstrap.
  const fallbackDocument = useRef(initialDocument);

  // Open the journal and read it before the editor mounts: the editor reads
  // its initial content once, so handing it the empty document first would
  // silently discard whatever the author had saved locally.
  useEffect(() => {
    let cancelled = false;

    /**
     * A journal that cannot be opened or read is a failed local write as far
     * as the machine is concerned — the pair is dispatched so the failure
     * reaches ERROR / RECOVERY_REQUIRED instead of being swallowed as an
     * illegal transition out of EDITING.
     */
    const reportLocalFailure = (reason: LocalSaveFailureReason) => {
      dispatch({ type: "LOCAL_SAVE_STARTED" });
      dispatch({ type: "LOCAL_SAVE_FAILED", reason });
    };

    void (async () => {
      const opened = await openJournal();
      if (cancelled) {
        return;
      }

      if (!opened.ok) {
        reportLocalFailure(opened.reason);
        setBootstrap({ document: fallbackDocument.current, baseRevision: 0 });
        return;
      }

      dbRef.current = opened.db;
      const loaded = await loadJournal(opened.db, documentId);
      if (cancelled) {
        return;
      }

      if (!loaded.ok) {
        reportLocalFailure(loaded.reason);
        setBootstrap({ document: fallbackDocument.current, baseRevision: 0 });
        return;
      }

      const snapshot = loaded.contents.snapshot;
      setBootstrap(
        snapshot
          ? { document: snapshot.document, baseRevision: snapshot.revision }
          : { document: initialDocument, baseRevision: 0 },
      );
      baseRevision.current = snapshot?.revision ?? 0;
      if (snapshot) {
        // Recovered text that still owes the server is locally durable, not
        // synced; the pending queue is drained in F1-4b.
        dispatch({ type: "LOCAL_SAVE_STARTED" });
        dispatch({ type: "LOCAL_SAVE_OK" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId, initialDocument]);

  const handleChange = useCallback(
    (next: CanonicalCandidate) => {
      setCandidate(next);

      // A candidate the canonical model cannot express is never journalled:
      // storing it would make the snapshot unreadable on the next visit.
      if (!next.ok) {
        return;
      }

      const db = dbRef.current;
      dispatch({ type: "EDIT" });
      dispatch({ type: "LOCAL_SAVE_STARTED" });
      if (!db) {
        dispatch({ type: "LOCAL_SAVE_FAILED", reason: "unavailable" });
        return;
      }

      void saveLocal(db, documentId, next.doc, baseRevision.current).then((result) => {
        dispatch(
          result.ok
            ? { type: "LOCAL_SAVE_OK" }
            : { type: "LOCAL_SAVE_FAILED", reason: result.reason },
        );
      });
    },
    [documentId],
  );

  if (!bootstrap) {
    return (
      <div data-sync-state={syncState}>
        <p style={statusRow}>Učitavanje…</p>
      </div>
    );
  }

  const rejected = candidate !== null && !candidate.ok ? candidate : null;

  return (
    <div data-sync-state={syncState}>
      <DocumentEditor
        initialDocument={bootstrap.document}
        onCanonicalChange={handleChange}
      />

      {rejected === null ? (
        <p style={statusRow}>
          {candidate !== null && candidate.ok ? (
            <>
              <span>Blokova: {countNodes(candidate.doc)}</span>
              <span>Riječi: {countWords(candidate.doc)}</span>
            </>
          ) : null}
          {/* F1-3b replaces the raw constant with the Croatian status chip. */}
          <span data-testid="sync-state">{syncState}</span>
        </p>
      ) : (
        <div style={problem}>
          <p style={{ margin: 0 }}>
            Tekst sadrži oblikovanje koje ovaj uređivač još ne podržava, pa se ne može
            pretvoriti u kanonski zapis ({rejected.errors.length}{" "}
            {rejected.errors.length === 1 ? "problem" : "problema"}).
          </p>
        </div>
      )}
    </div>
  );
}
