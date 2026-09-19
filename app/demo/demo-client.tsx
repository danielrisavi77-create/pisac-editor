"use client";

/**
 * The public demo's client wrapper (no auth, no server).
 *
 * It is a deliberately LEAN parallel of `app/d/[id]/editor-client.tsx`: the
 * same `Editor`, the same journal, the same reducer and the same chip, wired
 * to the half of the system that exists without a signed-in owner. Nothing in
 * `editor-client.tsx` is touched, and nothing is extracted out of it — the two
 * files answer different questions and sharing a component between them would
 * mean one of the two lying about what it has.
 *
 * What is missing here is missing on purpose:
 *
 *   - NO drain runner, NO server props, NO checkpoint bar, NO conflict panel
 *     and NO recovery panel. Each of those is about canonical SERVER state,
 *     and this route has no server to hold any. A demo that mounted them would
 *     be showing controls that cannot do what they say.
 *   - Therefore the state machine settles at LOCAL_DURABLE after a save and
 *     never reaches SYNCED. That is the honest claim: the text is durable in
 *     this browser and nowhere else. The constitution's rule that local
 *     durable state is not canonical server state is exactly why SYNCED is not
 *     faked here — and why the DOCX export always reports local changes.
 *
 * What is kept from the real editor, because it is true here too:
 *
 *   - The journal writes in one atomic transaction and the reducer is driven
 *     from its result; `onDirty` leaves LOCAL_DURABLE the instant the author
 *     types, so the chip never claims durability for text that is not written.
 *   - One writer per tab, through the same Web Lock helper under a demo-scoped
 *     name: two demo tabs sharing one IndexedDB snapshot would be the silent
 *     last-write-wins the constitution forbids, demo or not.
 *   - The pending projection is flushed on `pagehide` and on unmount, so the
 *     last debounce window is not simply dropped.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import SyncStatusChip from "@/components/SyncStatusChip";
import DocumentEditor, { type EditorFlushHandle } from "@/editor/Editor";
import { countNodes, countWords, type CanonicalCandidate } from "@/editor/interop";
import { emptyDocument, type CanonicalDocument } from "@/domain/document";
import {
  INITIAL_SYNC_STATE,
  restoreSyncState,
  syncReducer,
  type LocalSaveFailureReason,
  type SyncState,
} from "@/domain/sync";
import { openJournal, type JournalDatabase } from "@/lib/journal/db";
import { JOURNAL_FROZEN, loadJournal, saveLocal } from "@/lib/journal/journal";
import { acquireDocumentLock, documentLockName } from "@/lib/journal/lock";
import { blocksHr, problemsHr, wordsHr } from "@/lib/i18n/hr";

import DocxExportBar from "../d/[id]/docx-export-bar";

/**
 * The journal key every visitor's demo shares inside their own browser.
 *
 * Fixed, and deliberately not a uuid: the point of the demo is that closing
 * the tab and coming back shows the same text. Real documents are keyed by
 * their project uuid, so "demo" cannot collide with one.
 */
export const DEMO_DOCUMENT_ID = "demo";

/** Names the exported DOCX file. */
const DEMO_TITLE = "Demo";

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
 * Said once, when the local store cannot take the text at all.
 *
 * The editor stays usable — refusing to render it would be a worse answer for
 * someone who only wants to see what Pisač feels like — but the sentence, like
 * the chip above it, does not pretend anything is being kept.
 */
const NO_STORAGE_MESSAGE =
  "Ovaj preglednik ne dopušta lokalnu pohranu, pa se tekst iz demoa ne sprema. Uređivanje i dalje radi.";

/** The state a failed local probe lands in, derived from the machine itself. */
function stateAfterLocalFailure(reason: LocalSaveFailureReason): SyncState {
  return syncReducer(syncReducer(INITIAL_SYNC_STATE, { type: "LOCAL_SAVE_STARTED" }), {
    type: "LOCAL_SAVE_FAILED",
    reason,
  });
}

type Boot =
  | { status: "loading" }
  | {
      status: "ready";
      db: JournalDatabase | null;
      document: CanonicalDocument;
      state: SyncState;
      /** 'multi-tab' when another demo tab holds the writer lock. */
      blocked: LocalSaveFailureReason | "multi-tab" | null;
    };

export default function DemoClient() {
  const [boot, setBoot] = useState<Boot>({ status: "loading" });

  // Open the journal, claim the writer lock and read what is stored before the
  // editor mounts: the editor takes its initial content once, so starting it
  // on the empty document would discard whatever this browser already holds.
  useEffect(() => {
    let cancelled = false;
    let release = () => {};

    void (async () => {
      const opened = await openJournal();
      if (cancelled) {
        return;
      }
      if (!opened.ok) {
        // No store at all. There is no server copy to be careful about here,
        // so an empty document is honest — unlike on /d/[id], where it could
        // invite the author to commit over text this request failed to read.
        setBoot({
          status: "ready",
          db: null,
          document: emptyDocument(),
          state: stateAfterLocalFailure(opened.reason),
          blocked: opened.reason,
        });
        return;
      }

      const lock = await acquireDocumentLock(documentLockName(DEMO_DOCUMENT_ID));
      release = lock.release;
      if (cancelled) {
        release();
        return;
      }

      const loaded = await loadJournal(opened.db, DEMO_DOCUMENT_ID);
      if (cancelled) {
        return;
      }
      if (!loaded.ok) {
        setBoot({
          status: "ready",
          db: null,
          document: emptyDocument(),
          state: stateAfterLocalFailure(loaded.reason),
          blocked: loaded.reason,
        });
        return;
      }

      const snapshot = loaded.contents.snapshot;
      setBoot({
        status: "ready",
        // A tab that is not the writer gets no journal handle at all, exactly
        // as on /d/[id]: it may be read and typed in, it may not write.
        db: lock.held ? opened.db : null,
        document: snapshot?.document ?? emptyDocument(),
        state: lock.held
          ? // Only EDITING and LOCAL_DURABLE are reachable in the demo, since
            // nothing here ever records a sticky or a server state; the
            // restore rule is reused rather than re-derived so a journal
            // written by the real editor is still read by its own rules.
            restoreSyncState(loaded.contents)
          : stateAfterLocalFailure("unavailable"),
        blocked: lock.held ? null : "multi-tab",
      });
    })();

    return () => {
      cancelled = true;
      release();
    };
  }, []);

  if (boot.status === "loading") {
    return (
      <div data-sync-state={INITIAL_SYNC_STATE}>
        <p style={statusRow}>Učitavanje…</p>
      </div>
    );
  }

  return (
    <JournalledDemoEditor
      db={boot.db}
      document={boot.document}
      initialSyncState={boot.state}
      blocked={boot.blocked}
    />
  );
}

type JournalledDemoEditorProps = {
  /** `null` when this session must not write: no journal, or not the writer. */
  db: JournalDatabase | null;
  document: CanonicalDocument;
  initialSyncState: SyncState;
  blocked: LocalSaveFailureReason | "multi-tab" | null;
};

/**
 * Mounted only once the journal has been read, so the reducer can *start* in
 * the restored state instead of being nudged into it afterwards.
 */
function JournalledDemoEditor({
  db,
  document,
  initialSyncState,
  blocked,
}: JournalledDemoEditorProps) {
  const [syncState, dispatch] = useReducer(syncReducer, initialSyncState);
  const [candidate, setCandidate] = useState<CanonicalCandidate | null>(null);
  /** What the author is looking at, as a canonical document — what exports. */
  const [visibleDocument, setVisibleDocument] = useState<CanonicalDocument>(document);

  /**
   * The base revision every local save is written against.
   *
   * It is 0 and it stays 0: only a server ACK may advance a revision, and this
   * route has no server. A demo that incremented it locally would be inventing
   * canonical state.
   */
  const base = useRef(0);
  const flushRef = useMemo<EditorFlushHandle>(() => ({ current: null }), []);

  // Flush the pending projection when the session ends. Best effort by nature:
  // `saveLocal` is asynchronous, so a hard kill can still land between the
  // projection and the write — and EDITING is then the honest claim.
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
    // No content crosses this call — per-keystroke logging is forbidden.
    dispatch({ type: "EDIT" });
  }, [db]);

  const handleChange = useCallback(
    (next: CanonicalCandidate) => {
      setCandidate(next);
      if (next.ok) {
        setVisibleDocument(next.doc);
      }

      // A candidate the canonical model cannot express is never journalled:
      // storing it would make the snapshot unreadable on the next visit.
      if (!next.ok || !db) {
        return;
      }

      dispatch({ type: "EDIT" });
      dispatch({ type: "LOCAL_SAVE_STARTED" });
      void saveLocal(db, DEMO_DOCUMENT_ID, next.doc, base.current).then((result) => {
        if (result.ok) {
          // LOCAL_DURABLE, and that is where the demo stops: there is no drain
          // runner to notify and no ACK that could ever make this SYNCED.
          dispatch({ type: "LOCAL_SAVE_OK" });
          return;
        }
        if (result.reason === JOURNAL_FROZEN) {
          // Unreachable in the demo (nothing records a sticky state), but the
          // refusal is not a failure and must never be reported as one.
          return;
        }
        dispatch({ type: "LOCAL_SAVE_FAILED", reason: result.reason });
      });
    },
    [db],
  );

  /**
   * Whether the DOCX about to be handed over contains text the server has not
   * accepted. In the demo it always does: nothing is ever sent anywhere.
   */
  const hasLocalOnlyChanges = useCallback(async () => true, []);

  const rejected = candidate !== null && !candidate.ok ? candidate : null;
  const storageFailed = db === null && blocked !== "multi-tab";

  return (
    <div data-sync-state={syncState} data-sync-blocked={blocked ?? undefined}>
      <div className="status-bar">
        <SyncStatusChip state={syncState} blocked={blocked === "multi-tab"} />
      </div>

      <DocumentEditor
        initialDocument={document}
        onCanonicalChange={handleChange}
        onDirty={handleDirty}
        flushRef={flushRef}
      />

      {storageFailed ? (
        <div style={problem}>
          <p style={{ margin: 0 }}>{NO_STORAGE_MESSAGE}</p>
        </div>
      ) : null}

      {rejected === null ? (
        candidate !== null && candidate.ok ? (
          <p style={statusRow}>
            <span>{blocksHr(countNodes(candidate.doc))}</span>
            <span>{wordsHr(countWords(candidate.doc))}</span>
          </p>
        ) : null
      ) : (
        <div style={problem}>
          <p style={{ margin: 0 }}>
            Tekst sadrži oblikovanje koje ovaj uređivač još ne podržava, pa se ne može
            pretvoriti u kanonski zapis ({problemsHr(rejected.errors.length)}).
          </p>
        </div>
      )}

      {/*
        The same export as the real editor, unchanged: the packer runs entirely
        in the browser, so this is the one F1 capability the demo can offer in
        full. Its summary always carries the local-changes note, which is true.
      */}
      <DocxExportBar
        document={visibleDocument}
        title={DEMO_TITLE}
        hasLocalOnlyChanges={hasLocalOnlyChanges}
      />
    </div>
  );
}
