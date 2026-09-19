"use client";

/**
 * Client wrapper around the editor for one project.
 *
 * F1-3a gives this view the local durable journal: every debounced canonical
 * candidate is written to IndexedDB in one atomic transaction and the sync
 * state machine is driven from the result. LOCAL_DURABLE and SYNCED stay two
 * different claims — the journal can only ever justify the first one.
 *
 * F1-4a adds one thing only: the canonical server document and its revision
 * arrive as props and seed the bootstrap when the journal is empty.
 *
 * F1-4b closes the loop: a drain runner (`createDrainRunner`) takes the
 * pending queue to the server, and an ACK is what finally makes SYNCED true.
 * The runner lives entirely outside this component — this file only hands it
 * the journal, a `commit` bound to the server action, the reducer's dispatch
 * and a place to put the revision the server names. Only the writer tab gets
 * one, and it is stopped on unmount.
 *
 * F1-5a adds the only honest way out of a refused commit: the runner records
 * the conflict (both versions, kept) before the machine claims CONFLICT, the
 * editor goes read-only, and `conflict-panel` asks the author to choose. Both
 * choices are applied here — a rebase journals my document against the
 * server's revision and lets the drain re-attempt it; a discard adopts the
 * server's document in one journal transaction. Neither deletes the record.
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
  serverSyncErrorToOutcome,
  syncReducer,
  type ConflictRecord,
  type ConflictResolutionOk,
  type DrainOutcome,
  type JournalContents,
  type LocalSaveFailureReason,
  type SyncState,
} from "@/domain/sync";
import type { DocumentTransaction } from "@/domain/document";
import {
  LOAD_FAILURE_MESSAGE,
  resolveInitialDocument,
  type RevisionedDocument,
} from "@/domain/serverSync/bootstrap";
import { openJournal, type JournalDatabase } from "@/lib/journal/db";
import {
  adoptServerDocument,
  loadJournal,
  loadUnresolvedConflict,
  markConflictResolved,
  markState,
  refreshConflictServerSide,
  saveLocal,
  type FetchServerFn,
} from "@/lib/journal/journal";
import { acquireDocumentLock, documentLockName } from "@/lib/journal/lock";
import { createDrainRunner, type DrainRunner } from "@/lib/sync/drainRunner";

import { commitDocument, loadDocument } from "./actions";
import ConflictPanel from "./conflict-panel";

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
   * Plumbed in by F1-4a; from F1-4b the drain runner commits the pending
   * queue against it.
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

/**
 * One commit round trip, in the vocabulary the drain runner understands.
 *
 * Everything that is not an answer from `pisac_commit_document` becomes
 * `transport_error` — the one retryable outcome — because a round trip that
 * did not complete has told us nothing about the server, and the queue is
 * still owed. A rejected promise counts: a server action can fail on the wire,
 * and a throw here would leave the runner's latch stuck instead of retrying.
 * Typed error codes are mapped by `serverSyncErrorToOutcome`, so `prevelik`
 * stays a refusal and does not masquerade as a network hiccup.
 */
async function commitViaServer(
  projectId: string,
  tx: DocumentTransaction,
): Promise<DrainOutcome> {
  try {
    const result = await commitDocument(projectId, tx);
    return result.ok ? result.value : serverSyncErrorToOutcome(result.code);
  } catch {
    return { status: "transport_error" };
  }
}

/**
 * Reads the canonical server document for the conflict record (F1-5a).
 *
 * `null` for every unhappy answer, including a throw: the conflict is recorded
 * either way, and a conflict whose server side is missing is honestly shown as
 * such rather than guessed at.
 */
async function fetchServerDocument(projectId: string) {
  try {
    const result = await loadDocument(projectId);
    return result.ok
      ? { document: result.value.document, revision: result.value.revision }
      : null;
  } catch {
    return null;
  }
}

/** Shown when a resolution could not be written to the local journal. */
const RESOLUTION_FAILED_MESSAGE =
  "Odluku nije bilo moguće spremiti u lokalnu pohranu. Pokušaj ponovno.";

/** The state a failed local probe lands in, derived from the machine itself. */
function stateAfterLocalFailure(reason: LocalSaveFailureReason): SyncState {
  return syncReducer(syncReducer(INITIAL_SYNC_STATE, { type: "LOCAL_SAVE_STARTED" }), {
    type: "LOCAL_SAVE_FAILED",
    reason,
  });
}

export default function EditorClient({
  documentId,
  projectId,
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
        projectId={projectId}
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
      projectId={projectId}
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
  /** The project whose canonical server document the drain commits to. */
  projectId: string;
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
  projectId,
  document,
  baseRevision,
  initialSyncState,
  blocked,
}: JournalledEditorProps) {
  const [syncState, dispatch] = useReducer(syncReducer, initialSyncState);
  const [candidate, setCandidate] = useState<CanonicalCandidate | null>(null);
  /** The conflict the author is being asked about, while state is CONFLICT. */
  const [conflict, setConflict] = useState<ConflictRecord | null>(null);

  const base = useRef(baseRevision);
  const lastError = useRef<LocalSaveFailureReason | undefined>(undefined);
  const flushRef = useMemo<EditorFlushHandle>(() => ({ current: null }), []);
  const runner = useRef<DrainRunner | null>(null);

  /*
   * The drain, for the writer tab only.
   *
   * `db` is null when this session must not write — no journal, or another tab
   * holds the lock — and a session that must not write must not commit either:
   * two tabs draining the same queue would race for the same rows and the
   * loser would be raising conflicts against its own twin.
   *
   * `onServerRevision` moves the base every later save is written against.
   * That is the only place a revision enters this component from outside a
   * server answer; nothing here ever increments one.
   *
   * `dispatch` from `useReducer` is stable, and so are the refs, so this runs
   * once per journal — and `stop()` on teardown cancels the timers and makes
   * the runner ignore whatever is still in flight.
   */
  /** One place the server document is read from, for both runner and panel. */
  const fetchServer = useCallback<FetchServerFn>(
    () => fetchServerDocument(projectId),
    [projectId],
  );

  useEffect(() => {
    if (!db) {
      return;
    }
    const drain = createDrainRunner({
      db,
      documentId,
      commit: (tx) => commitViaServer(projectId, tx),
      dispatch,
      onServerRevision: (revision) => {
        base.current = revision;
      },
      // On a refused CAS the runner fetches the server's version and records
      // the conflict BEFORE it claims CONFLICT (F1-5a).
      fetchServer,
    });
    runner.current = drain;
    return () => {
      drain.stop();
      runner.current = null;
    };
  }, [db, documentId, projectId, fetchServer]);

  /*
   * The conflict the panel asks about.
   *
   * Runs both when the drain raises a conflict during this session and when a
   * session opens with a persisted CONFLICT — a reload is not a decision, so
   * the restored state brings its record back with it. A record whose server
   * side is missing (the follow-up read failed when the conflict was detected,
   * or the tab was closed offline) is refreshed here, which is what turns the
   * disabled "Preuzmi noviju verziju" button back on.
   */
  useEffect(() => {
    if (!db || syncState !== "CONFLICT") {
      setConflict(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const loaded = await loadUnresolvedConflict(db, documentId);
      if (cancelled || !loaded.ok) {
        return;
      }

      let record = loaded.conflict;
      if (record && record.serverDocument === null) {
        const refreshed = await refreshConflictServerSide(db, documentId, fetchServer);
        if (cancelled) {
          return;
        }
        if (refreshed.ok && refreshed.conflict) {
          record = refreshed.conflict;
        }
      }

      if (!cancelled) {
        setConflict(record);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, documentId, syncState, fetchServer]);

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
      flushRef.current?.flush();
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
          // Durable locally — now it owes the server. The runner coalesces a
          // burst of these into one round trip.
          runner.current?.notifyLocalSave();
          return;
        }
        lastError.current = result.reason;
        dispatch({ type: "LOCAL_SAVE_FAILED", reason: result.reason });
      });
    },
    [db, documentId],
  );

  /**
   * Applies the author's explicit conflict resolution (F1-5a).
   *
   * The decision itself was taken by `resolveConflict` in the panel; this is
   * the part that touches the world, and the order of every step is load
   * bearing:
   *
   *   rebase  — journal my document against the SERVER's revision first, so
   *             the rebased content is durable before it is announced; only
   *             then leave CONFLICT (CONFLICT_RESOLVED → SAVING_LOCAL) and
   *             report the save that already happened (LOCAL_SAVE_OK →
   *             LOCAL_DURABLE). The drain halt is lifted explicitly and the
   *             queue is re-attempted. The CAS remains the backstop: if a
   *             third writer commits in between, this comes back as another
   *             honest conflict rather than an overwrite.
   *   discard — adopt the server's document in ONE journal transaction
   *             (snapshot + queue + meta), replace what the editor is showing,
   *             and only then leave CONFLICT. The conflict ROW survives with
   *             the discarded document on it; `markConflictResolved` adds the
   *             decision to it and deletes nothing.
   *
   * A journal that refuses the write leaves the document in CONFLICT and says
   * so: a decision that was not recorded has not been made, and pretending
   * otherwise would strand the author in a state whose exit has already been
   * spent.
   */
  const handleResolved = useCallback(
    async (outcome: ConflictResolutionOk): Promise<string | null> => {
      if (!db) {
        return RESOLUTION_FAILED_MESSAGE;
      }

      if (outcome.via === "rebase") {
        const saved = await saveLocal(
          db,
          documentId,
          outcome.nextDocument,
          outcome.nextBaseRevision,
        );
        if (!saved.ok) {
          lastError.current = saved.reason;
          return RESOLUTION_FAILED_MESSAGE;
        }

        base.current = outcome.nextBaseRevision;
        lastError.current = undefined;
        dispatch({ type: "CONFLICT_RESOLVED", via: "rebase" });
        dispatch({ type: "LOCAL_SAVE_OK" });
        await markConflictResolved(db, documentId, "rebase");
        runner.current?.resumeAfterConflict();
        runner.current?.notifyLocalSave();
        return null;
      }

      const adopted = await adoptServerDocument(
        db,
        documentId,
        outcome.nextDocument,
        outcome.nextBaseRevision,
      );
      if (!adopted.ok) {
        lastError.current = adopted.reason;
        return RESOLUTION_FAILED_MESSAGE;
      }

      base.current = outcome.nextBaseRevision;
      lastError.current = undefined;
      flushRef.current?.setDocument(outcome.nextDocument);
      dispatch({ type: "CONFLICT_RESOLVED", via: "discard" });
      await markConflictResolved(db, documentId, "discard");
      runner.current?.resumeAfterConflict();
      return null;
    },
    [db, documentId, flushRef],
  );

  /** Another go at reading the server's version for a half-known conflict. */
  const handleRefresh = useCallback(async () => {
    if (!db) {
      return;
    }
    const refreshed = await refreshConflictServerSide(db, documentId, fetchServer);
    if (refreshed.ok && refreshed.conflict) {
      setConflict(refreshed.conflict);
    }
  }, [db, documentId, fetchServer]);

  const rejected = candidate !== null && !candidate.ok ? candidate : null;

  return (
    <div data-sync-state={syncState} data-sync-blocked={blocked ?? undefined}>
      <div style={statusBar}>
        <SyncStatusChip state={syncState} blocked={blocked === "multi-tab"} />
      </div>

      {/*
        The panel sits ABOVE the editor: it is a question that has to be
        answered, not a footnote under the text it is about.
      */}
      {syncState === "CONFLICT" && conflict !== null ? (
        <ConflictPanel
          record={conflict}
          onResolved={handleResolved}
          onRefresh={handleRefresh}
        />
      ) : null}

      <DocumentEditor
        initialDocument={document}
        onCanonicalChange={handleChange}
        onDirty={handleDirty}
        flushRef={flushRef}
        // Read-only while the author is being asked to choose between two
        // versions: a third one typed into the middle of that question would
        // make whichever they pick untrue by the time it is applied.
        editable={syncState !== "CONFLICT"}
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
