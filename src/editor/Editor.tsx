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

import type { CanonicalDocument } from "../domain/document";

import {
  canonicalToTiptap,
  tiptapToCanonical,
  type CanonicalCandidate,
} from "./interop";
import { createEditorExtensions, DEFAULT_PLACEHOLDER } from "./schema";

/** Debounce for the editor → canonical projection, in milliseconds. */
export const DEFAULT_DEBOUNCE_MS = 500;

export type EditorProps = {
  /** The document the session starts from. Read once, on mount. */
  initialDocument: CanonicalDocument;
  /**
   * Called with a fresh candidate after the author stops typing. Debounced:
   * this is a document-level projection, never a per-keystroke record.
   */
  onCanonicalChange?: (candidate: CanonicalCandidate) => void;
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
  onPress,
}: {
  label: string;
  pressed: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      style={pressed ? activeToolbarButton : toolbarButton}
    >
      {label}
    </button>
  );
}

export default function DocumentEditor({
  initialDocument,
  onCanonicalChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  placeholder = DEFAULT_PLACEHOLDER,
}: EditorProps) {
  // The initial content is read once: re-projecting it on every render would
  // fight the author's cursor. Later document changes arrive through F1-3a.
  const [initialContent] = useState(() => canonicalToTiptap(initialDocument));

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in refs so a changing callback or delay never re-creates the editor
  // (which would throw away the undo history and the caret).
  const notify = useRef(onCanonicalChange);
  const delay = useRef(debounceMs);

  useEffect(() => {
    notify.current = onCanonicalChange;
    delay.current = debounceMs;
  }, [onCanonicalChange, debounceMs]);

  const project = useCallback((editor: Editor) => {
    notify.current?.(tiptapToCanonical(editor.getJSON()));
  }, []);

  const editor = useEditor({
    immediatelyRender: false, // The page is server-rendered; hydrate first.
    extensions: createEditorExtensions(placeholder),
    content: initialContent,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Tekst rada",
      },
    },
    onUpdate: ({ editor: updated }) => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        project(updated);
      }, delay.current);
    },
  });

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
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
          onPress={() => editor?.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Kurziv"
          pressed={state.italic}
          onPress={() => editor?.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="Naslov 1"
          pressed={state.heading1}
          onPress={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        />
        <ToolbarButton
          label="Naslov 2"
          pressed={state.heading2}
          onPress={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          label="Naslov 3"
          pressed={state.heading3}
          onPress={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <ToolbarButton
          label="Odlomak"
          pressed={state.paragraph}
          onPress={() => editor?.chain().focus().setParagraph().run()}
        />
      </div>

      <EditorContent editor={editor} style={surface} />
    </div>
  );
}
