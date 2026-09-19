"use client";

/**
 * Client wrapper around the editor for one project.
 *
 * F1-3a gives this view the local durable journal: every debounced canonical
 * candidate is written to IndexedDB in one atomic transaction and the sync
 * state machine is driven from the result. There is still no server sync
 * (F1-4b), so a document here can reach LOCAL_DURABLE and never SYNCED — and
 * it says exactly that, rather than a generic "saved".
 *
 * F1-4a adds one thing only: the canonical server document and its revision
 * arrive as props and seed the bootstrap when the journal is empty. Nothing
 * here sends anything yet; the pending queue is still drained by nobody.
 *
 * Three honesty rules shape the wiring:
 *
 *   1. The persisted `meta.state` wins on reload. CONFLICT and
 *      RECOVERY_REQUIRED may only be left by an explicit decision, and
 *      re-opening a tab is not one; a session that synthesised its own state
 *      from the snapshot would quietly clear them.
 *   2. The chip never claims durability for text that is not written. The
 *      editor reports `onDirty` synchronously on every change — a bare signal,
 *      no content — so the state leaves LOCAL_DURABLE the instant the author
 *      types, not when the debounce expires. On unmount and on `pagehide` the
 *      pending projection is flushed, so the last window is not dropped.
 *   3. One writer per document. A second tab on the same document does not
 *      journal at all (see `acquireDocumentLock`), because replacing the
 *      snapshot behind another tab's back is a silent last-write-wins.
 *
 * The state is shown by the F1-3b status chip, which reads its wording from
 * `@/domain/sync/labels`. The raw constant stays in `data-sync-state` (and the
 * multi-tab flag in `data-sync-blocked`) purely as an E2E hook: tests assert on
 * the machine's vocabulary, authors read Croatian.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import SyncStatusChip from "@/components/SyncStatusChip";
import DocumentEditor, { type EditorFlushHandle } from "@/editor/Editor";
import { countNodes, countWords, type CanonicalCandidate } from "@/editor/interop";
import type { CanonicalDocument } from "@/domain/document";
import {
  INITIAL_SYNC_STATE,
  restoreSyncState,
  syncReducer,
  type JournalContents,
  type LocalSaveFailureReason,
  type SyncState,
} from "@/domain/sync";
import {
  LOAD_FAILURE_MESSAGE,
  resolveInitialDocument,
  type RevisionedDocument,
} from "@/domain/serverSync/bootstrap";
import { openJournal, type JournalDatabase } from "@/lib/journal/db";
import { loadJournal, markState, saveLocal } from "@/lib/journal/journal";
import { acquireDocumentLock, documentLockName } from "@/lib/journal/lock";

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

/**
 * The chip rides above the editor and stays put while the author scrolls: a
 * status claim that can be scrolled out of sight is a status claim the author
 * stops checking.
 */
const statusBar = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  display: "flex",
  justifyContent: "flex-end",
  padding: "0.35rem 0",
  background: "var(--bg)",
} as const;

/**
 * Why this tab is not journalling, when it is not. `'multi-tab'` is a UI-level
 * reason only: it is never written to the journal, because the tab that is
 * locked out must not touch the store the writer tab owns — a persisted
 * 'multi-tab' error would also reappear on the next, perfectly healthy reload.
 */
type BlockedReason = LocalSaveFailureReason | "multi-tab";

export type EditorClientProps = {
  /** Journal key for the local store. Today the project id; it is the id the journal was written under. */
  documentId: string;
  /**
   * The project whose canonical server document this view commits to.
   * Plumbed in by F1-4a and consumed by the pending-queue drain in F1-4b;
   * nothing in this step sends anything to the server.
   */
  projectId: string;
  /** Canonical server document, or `null` when this request could not read one. */
  initialServerDocument: CanonicalDocument | null;
  /** Canonical server revision, or `null` when unknown. Never invented locally. */
  serverRevision: number | null;
};

type Boot =
  | { status: "loading" }
  | {
      status: "ready";
      db: JournalDatabase;
      contents: JournalContents;
      /** False when another tab holds the writer lock. */
      writable: boolean;
    }
  | { status: "failed"; reason: LocalSaveFailureReason };

/** The state a failed local probe lands in, derived from the machine itself. */
function stateAfterLocalFailure(reason: LocalSaveFailureReason): SyncState {
  return syncReducer(syncReducer(INITIAL_SYNC_STATE, { type: "LOCAL_SAVE_STARTED" }), {
    type: "LOCAL_SAVE_FAILED",
    reason,
  });
}

export default function EditorClient({
  documentId,
  initialServerDocument,
  serverRevision,
}: EditorClientProps) {
  const [boot, setBoot] = useState<Boot>({ status: "loading" });

  /**
   * The server side of the bootstrap, or `null`. Both halves are required:
   * a document without its revision is not something a compare-and-set can
   * ever be built on, so it is treated as no answer at all.
   */
  const server: RevisionedDocument | null =
    initialServerDocument !== null && serverRevision !== null
      ? { document: initialServerDocument, revision: serverRevision }
      : null;

  // Open the journal, claim the writer lock and read the journal before the
  // editor mounts: the editor takes its initial content once, so starting it
  // on the empty document would discard whatever was saved locally.
  useEffect(() => {
    let cancelled = false;
    let release = () => {};

    void (async () => {
      const opened = await openJournal();
      if (cancelled) {
        return;
      }
      if (!opened.ok) {
        setBoot({ status: "failed", reason: opened.reason });
        return;
      }

      const lock = await acquireDocumentLock(documentLockName(documentId));
      release = lock.release;
      if (cancelled) {
        release();
        return;
      }

      const loaded = await loadJournal(opened.db, documentId);
      if (cancelled) {
        return;
      }
      if (!loaded.ok) {
        setBoot({ status: "failed", reason: loaded.reason });
        return;
      }

      setBoot({
        status: "ready",
        db: opened.db,
        contents: loaded.contents,
        writable: lock.held,
      });
    })();

    return () => {
      cancelled = true;
      release();
    };
  }, [documentId]);

  if (boot.status === "loading") {
    return (
      <div data-sync-state={INITIAL_SYNC_STATE}>
        <p style={statusRow}>Učitavanje…</p>
      </div>
    );
  }

  if (boot.status === "failed") {
    // No journal at all, so the server document is the only candidate. If it
    // is missing too there is nothing honest to edit.
    const resolved = resolveInitialDocument(null, server);
    if (resolved.mode === "error") {
      return <LoadFailure />;
    }

    // The page stays editable, but nothing about this session is durable and
    // the state says so.
    return (
      <JournalledEditor
        key={`${documentId}:no-journal`}
        db={null}
        documentId={documentId}
        document={resolved.document}
        baseRevision={resolved.revision}
        initialSyncState={stateAfterLocalFailure(boot.reason)}
        blocked={boot.reason}
      />
    );
  }

  const snapshot = boot.contents.snapshot;
  const resolved = resolveInitialDocument(
    snapshot ? { document: snapshot.document, revision: snapshot.revision } : null,
    server,
  );

  if (resolved.mode === "error") {
    return <LoadFailure />;
  }

  return (
    <JournalledEditor
      key={documentId}
      db={boot.writable ? boot.db : null}
      documentId={documentId}
      document={resolved.document}
      baseRevision={resolved.revision}
      initialSyncState={
        boot.writable
          ? restoreSyncState(boot.contents)
          : stateAfterLocalFailure("unavailable")
      }
      blocked={boot.writable ? null : "multi-tab"}
    />
  );
}

/**
 * Neither the journal nor the server could supply a document.
 *
 * No editor is mounted: an empty editor here would be a blank page the author
 * could type into and then commit over canonical text this request failed to
 * read. ERROR is one of the 8 states, so the chip can say it in the machine's
 * own vocabulary rather than inventing a ninth.
 */
function LoadFailure() {
  return (
    <div data-sync-state="ERROR">
      <div style={statusBar}>
        <SyncStatusChip state="ERROR" />
      </div>
      <div style={problem}>
        <p style={{ margin: 0 }}>{LOAD_FAILURE_MESSAGE}</p>
      </div>
    </div>
  );
}

type JournalledEditorProps = {
  /** `null` when this session must not write: no journal, or not the writer. */
  db: JournalDatabase | null;
  documentId: string;
  document: CanonicalDocument;
  baseRevision: number;
  initialSyncState: SyncState;
  blocked: BlockedReason | null;
};

/**
 * Mounted only once the journal has been read, so the reducer can *start* in
 * the restored state instead of being nudged into it afterwards.
 */
function JournalledEditor({
  db,
  documentId,
  document,
  baseRevision,
  initialSyncState,
  blocked,
}: JournalledEditorProps) {
  const [syncState, dispatch] = useReducer(syncReducer, initialSyncState);
  const [candidate, setCandidate] = useState<CanonicalCandidate | null>(null);

  const base = useRef(baseRevision);
  const lastError = useRef<LocalSaveFailureReason | undefined>(undefined);
  const flushRef = useMemo<EditorFlushHandle>(() => ({ current: null }), []);

  // Persist the states that must survive a reload. Fire-and-forget: this is a
  // best-effort record, and a store that cannot take it is already reflected
  // in the state being written. Only the writer tab records anything.
  useEffect(() => {
    if (!db) {
      return;
    }
    if (
      syncState !== "CONFLICT" &&
      syncState !== "ERROR" &&
      syncState !== "RECOVERY_REQUIRED"
    ) {
      return;
    }
    void markState(db, documentId, syncState, lastError.current);
  }, [db, documentId, syncState]);

  // Flush the pending projection when the session ends. Best effort by
  // nature: `saveLocal` is asynchronous, so a hard kill (tab crash, power
  // loss) can still end between the projection and the commit — and EDITING,
  // which is what the state says at that moment, is then the honest claim.
  useEffect(() => {
    const flush = () => {
      flushRef.current?.();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [flushRef]);

  const handleDirty = useCallback(() => {
    if (!db) {
      return;
    }
    // Payload-free: the document moved, so stop claiming the text is durable.
    dispatch({ type: "EDIT" });
  }, [db]);

  const handleChange = useCallback(
    (next: CanonicalCandidate) => {
      setCandidate(next);

      // A candidate the canonical model cannot express is never journalled:
      // storing it would make the snapshot unreadable on the next visit.
      if (!next.ok || !db) {
        return;
      }

      dispatch({ type: "EDIT" });
      dispatch({ type: "LOCAL_SAVE_STARTED" });
      void saveLocal(db, documentId, next.doc, base.current).then((result) => {
        if (result.ok) {
          lastError.current = undefined;
          dispatch({ type: "LOCAL_SAVE_OK" });
          return;
        }
        lastError.current = result.reason;
        dispatch({ type: "LOCAL_SAVE_FAILED", reason: result.reason });
      });
    },
    [db, documentId],
  );

  const rejected = candidate !== null && !candidate.ok ? candidate : null;

  return (
    <div data-sync-state={syncState} data-sync-blocked={blocked ?? undefined}>
      <div style={statusBar}>
        <SyncStatusChip state={syncState} blocked={blocked === "multi-tab"} />
      </div>

      <DocumentEditor
        initialDocument={document}
        onCanonicalChange={handleChange}
        onDirty={handleDirty}
        flushRef={flushRef}
      />

      {/*
        The multi-tab notice is not repeated here: the chip above already
        carries that exact sentence, and saying it twice would suggest two
        different facts.
      */}

      {rejected === null ? (
        candidate !== null && candidate.ok ? (
          <p style={statusRow}>
            <span>Blokova: {countNodes(candidate.doc)}</span>
            <span>Riječi: {countWords(candidate.doc)}</span>
          </p>
        ) : null
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
