"use client";

/**
 * The F1 editor surface.
 *
 * Deliberately thin: every rule about what a document may contain lives in
 * `interop.ts` and in the domain, not here. This file only wires Tiptap to
 * those, so the editor stays a projection of the canonical document rather
 * than a second source of truth.
 *
 * Formatting is applied through Tiptap commands only. `document.execCommand`
 * is never used: it is deprecated, it mutates the DOM behind ProseMirror's
 * back, and the resulting state could not be projected back reliably.
 *
 * Nothing is persisted here — F1-3a owns the local journal and F1-4a the
 * server. `onCanonicalChange` hands the caller a *candidate*, nothing more.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";

import type { CanonicalDocument } from "../domain/document";

import {
  canonicalToTiptap,
  tiptapToCanonical,
  type CanonicalCandidate,
} from "./interop";
import { createEditorExtensions, DEFAULT_PLACEHOLDER } from "./schema";

/** Debounce for the editor → canonical projection, in milliseconds. */
export const DEFAULT_DEBOUNCE_MS = 500;

/**
 * What the owner may do to the editor from outside the render tree.
 *
 * Two operations, both of which have to bypass props: `flush` because the
 * owner needs the pending projection *now* (the session is ending), and
 * `setDocument` because the content is read once on mount — re-projecting it
 * through a prop on every render would fight the author's cursor.
 */
export type EditorHandle = {
  /** Projects the candidate that is still inside the debounce window. */
  flush: () => void;
  /**
   * Replaces the whole document. The only caller in F1 is an explicit conflict
   * DISCARD (F1-5a), where the author has chosen to adopt the server's
   * version — which is why it also clears the undo history (see below).
   */
  setDocument: (doc: CanonicalDocument) => void;
};

/**
 * Handle through which the owner reaches the editor. A plain mutable box
 * rather than a React ref type, so the caller may keep it anywhere (a ref, a
 * closure) without importing React's ref generics.
 */
export type EditorFlushHandle = { current: EditorHandle | null };

export type EditorProps = {
  /** The document the session starts from. Read once, on mount. */
  initialDocument: CanonicalDocument;
  /**
   * Called with a fresh candidate after the author stops typing. Debounced:
   * this is a document-level projection, never a per-keystroke record.
   */
  onCanonicalChange?: (candidate: CanonicalCandidate) => void;
  /**
   * Called synchronously on every change, before the debounce — with no
   * payload at all. It carries the single bit "the document moved", so the
   * owner can stop claiming durability for text that is not written yet.
   * Passing no content is what keeps this a state signal and not the
   * per-keystroke log the constitution forbids.
   */
  onDirty?: () => void;
  /**
   * Filled with a function that projects the pending candidate immediately.
   * The owner calls it when the session is about to end (unmount, `pagehide`)
   * so the last debounce window is not simply dropped.
   */
  flushRef?: EditorFlushHandle;
  /**
   * False makes the surface read-only. Used while the document is in CONFLICT
   * (F1-5a): the author is being asked to choose between two versions, and
   * typing a third one into the middle of that question would make whichever
   * they pick untrue by the time it is applied.
   */
  editable?: boolean;
  debounceMs?: number;
  placeholder?: string;
};

const toolbar = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.4rem",
  margin: "0 0 0.75rem",
} as const;

const toolbarButton = {
  padding: "0.35rem 0.7rem",
  borderRadius: "0.4rem",
  border: "1px solid var(--muted)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
} as const;

const activeToolbarButton = {
  ...toolbarButton,
  borderColor: "var(--fg)",
  background: "var(--fg)",
  color: "var(--bg)",
} as const;

const surface = {
  border: "1px solid var(--muted)",
  borderRadius: "0.5rem",
  padding: "1rem",
  minHeight: "18rem",
} as const;

type ToolbarState = {
  bold: boolean;
  italic: boolean;
  heading1: boolean;
  heading2: boolean;
  heading3: boolean;
  paragraph: boolean;
};

const IDLE_TOOLBAR: ToolbarState = {
  bold: false,
  italic: false,
  heading1: false,
  heading2: false,
  heading3: false,
  paragraph: false,
};

function readToolbarState(editor: Editor | null): ToolbarState {
  if (!editor) {
    return IDLE_TOOLBAR;
  }
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    heading1: editor.isActive("heading", { level: 1 }),
    heading2: editor.isActive("heading", { level: 2 }),
    heading3: editor.isActive("heading", { level: 3 }),
    paragraph: editor.isActive("paragraph"),
  };
}

function ToolbarButton({
  label,
  pressed,
  disabled,
  onPress,
}: {
  label: string;
  pressed: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onPress}
      style={
        disabled
          ? { ...toolbarButton, opacity: 0.5, cursor: "not-allowed" }
          : pressed
            ? activeToolbarButton
            : toolbarButton
      }
    >
      {label}
    </button>
  );
}

export default function DocumentEditor({
  initialDocument,
  onCanonicalChange,
  onDirty,
  flushRef,
  editable = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  placeholder = DEFAULT_PLACEHOLDER,
}: EditorProps) {
  // The initial content is read once: re-projecting it on every render would
  // fight the author's cursor. Later document changes arrive through F1-3a.
  const [initialContent] = useState(() => canonicalToTiptap(initialDocument));
  /*
   * The editable flag the editor is CREATED with.
   *
   * A session that opens on a persisted CONFLICT must mount read-only, not
   * mount editable and be corrected a tick later by an effect: that tick is
   * long enough for the author to type into a document whose fate they have
   * not decided yet. Read once, like the content; later changes go through the
   * effect below.
   */
  const [initialEditable] = useState(editable);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The editor whose change is still waiting out the debounce, so `flush` can
  // project it without reaching for a React-rendered value.
  const pendingEditor = useRef<Editor | null>(null);
  // Kept in refs so a changing callback or delay never re-creates the editor
  // (which would throw away the undo history and the caret).
  const notify = useRef(onCanonicalChange);
  const notifyDirty = useRef(onDirty);
  const delay = useRef(debounceMs);

  useEffect(() => {
    notify.current = onCanonicalChange;
    notifyDirty.current = onDirty;
    delay.current = debounceMs;
  }, [onCanonicalChange, onDirty, debounceMs]);

  const project = useCallback((editor: Editor) => {
    notify.current?.(tiptapToCanonical(editor.getJSON()));
  }, []);

  /**
   * Projects the waiting candidate now. A no-op when nothing is pending, and
   * defensive about a destroyed editor: the owner flushes while the session is
   * being torn down, and reading a destroyed ProseMirror view would throw on
   * the way out.
   */
  const flush = useCallback(() => {
    if (timer.current === null) {
      return;
    }
    clearTimeout(timer.current);
    timer.current = null;

    const waiting = pendingEditor.current;
    pendingEditor.current = null;
    if (!waiting || waiting.isDestroyed) {
      return;
    }
    project(waiting);
  }, [project]);

  const editor = useEditor({
    immediatelyRender: false, // The page is server-rendered; hydrate first.
    extensions: createEditorExtensions(placeholder),
    content: initialContent,
    editable: initialEditable,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Tekst rada",
      },
    },
    onUpdate: ({ editor: updated }) => {
      // Synchronous, payload-free: the owner learns *that* the document moved
      // the moment it moves, so nothing keeps claiming the text is durable
      // while the debounce window runs. No content crosses this call.
      notifyDirty.current?.();

      pendingEditor.current = updated;
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        pendingEditor.current = null;
        project(updated);
      }, delay.current);
    },
  });

  /**
   * Replaces the whole document with `doc`, with the undo history cleared.
   *
   * Two things have to happen together, and neither is optional:
   *
   *   1. The candidate still sitting in the debounce window is DROPPED. It
   *      describes the content being replaced, and letting it land after the
   *      replacement would journal the very text the author just discarded.
   *   2. The history is emptied, by rebuilding the editor state from the new
   *      document. ProseMirror's history plugin has no public "clear", and a
   *      plain `setContent` leaves the author one Ctrl+Z away from undoing a
   *      decision they made explicitly — restoring their local version on top
   *      of the server's without ever passing through the conflict machinery.
   *      A fresh `EditorState` re-initialises every plugin, history included.
   *
   * `emitUpdate: false` keeps this from looking like an authored change: it is
   * not one, and an `onUpdate` here would re-dirty a document that was just
   * brought into agreement with the server.
   */
  const setDocument = useCallback(
    (doc: CanonicalDocument) => {
      if (!editor || editor.isDestroyed) {
        return;
      }

      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      pendingEditor.current = null;

      editor.commands.setContent(canonicalToTiptap(doc), { emitUpdate: false });

      try {
        const { state: current, view } = editor;
        view.updateState(
          EditorState.create({ doc: current.doc, plugins: current.plugins }),
        );
      } catch {
        // The content is already correct; only the history reset failed.
        // Losing that is a usability wart, not a correctness one, and it must
        // not take the resolution down with it.
      }
    },
    [editor],
  );

  useEffect(() => {
    if (!flushRef) {
      return;
    }
    flushRef.current = { flush, setDocument };
    // Deliberately not cleared on cleanup: React tears an unmounting subtree
    // down from the top, so the owner's cleanup — the one that flushes — runs
    // after this effect is registered and possibly after its sibling teardown.
    // A handle nulled here would silently drop the author's last candidate.
  }, [flush, setDocument, flushRef]);

  /*
   * Read-only is a state of the surface, not of its content: the document is
   * still shown in full while the author decides how to resolve a conflict.
   *
   * Going read-only also DROPS the candidate still inside the debounce window.
   * `setEditable(false)` stops new typing but says nothing about typing that
   * already happened: a projection booked half a second ago would otherwise
   * land after the freeze and be journalled as if the author were still
   * editing — which is the write the conflict exists to prevent.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    if (editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
    if (!editable && timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
      pendingEditor.current = null;
    }
  }, [editor, editable]);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      pendingEditor.current = null;
    },
    [],
  );

  const state =
    useEditorState({ editor, selector: ({ editor: current }) => readToolbarState(current) }) ??
    IDLE_TOOLBAR;

  return (
    <div>
      <div style={toolbar} role="toolbar" aria-label="Oblikovanje teksta">
        <ToolbarButton
          label="Podebljano"
          pressed={state.bold}
          disabled={!editable}
          onPress={() => editor?.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Kurziv"
          pressed={state.italic}
          disabled={!editable}
          onPress={() => editor?.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="Naslov 1"
          pressed={state.heading1}
          disabled={!editable}
          onPress={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        />
        <ToolbarButton
          label="Naslov 2"
          pressed={state.heading2}
          disabled={!editable}
          onPress={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          label="Naslov 3"
          pressed={state.heading3}
          disabled={!editable}
          onPress={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <ToolbarButton
          label="Odlomak"
          pressed={state.paragraph}
          disabled={!editable}
          onPress={() => editor?.chain().focus().setParagraph().run()}
        />
      </div>

      <EditorContent editor={editor} style={surface} />
    </div>
  );
}
