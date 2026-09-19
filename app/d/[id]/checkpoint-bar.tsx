"use client";

/**
 * The checkpoint bar (F1-5b): naming a revision the server holds, and seeing
 * the names already given.
 *
 * Three honesty rules shape it:
 *
 *   1. A checkpoint is of the SERVER's revision. The confirmation therefore
 *      names that revision — "Kontrolna točka „X” stvorena (revizija 7)." —
 *      rather than saying anything as empty as "spremljeno".
 *   2. When something is still queued locally, the note below the
 *      confirmation says so. The author has to know that what they just
 *      bookmarked does not include their unsent text; letting them assume
 *      otherwise would be the same false claim of durability the eight sync
 *      states exist to prevent.
 *   3. Restoring is not offered. It is F2+ (docs/F1_STATE.md), and a button
 *      that did nothing, or that restored something approximately, would be
 *      worse than no button.
 *
 * The name is validated by the same pure rule the server action and the RPC
 * apply (`validateCheckpointName`), so the button is only live when the name
 * would actually be accepted.
 */

import { useState } from "react";

import {
  CHECKPOINT_NAME_MAX_LENGTH,
  formatCheckpointDate,
  validateCheckpointName,
  type CheckpointSummary,
} from "@/domain/serverSync/checkpoints";

const bar = {
  margin: "1.25rem 0 0",
} as const;

/*
 * The field grows to fill the row on a wide screen and drops to its own line
 * on a narrow one, where `1 1 14rem` would otherwise hold it beside a button
 * it cannot fit next to.
 */
const field = {
  flex: "1 1 14rem",
  minWidth: "0",
} as const;

const message = {
  margin: "0.6rem 0 0",
  lineHeight: 1.5,
} as const;

const note = {
  ...message,
  color: "var(--muted)",
  fontSize: "0.9rem",
} as const;

const list = {
  listStyle: "none",
  padding: 0,
  margin: "0.75rem 0 0",
  color: "var(--muted)",
  fontSize: "0.9rem",
} as const;

/** What the caller reports back after trying to create a checkpoint. */
export type CheckpointCreation =
  | { ok: true; message: string; note: string | null }
  | { ok: false; message: string };

export type CheckpointBarProps = {
  checkpoints: readonly CheckpointSummary[];
  onCreate: (name: string) => Promise<CheckpointCreation>;
};

export default function CheckpointBar({ checkpoints, onCreate }: CheckpointBarProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckpointCreation | null>(null);

  const validated = validateCheckpointName(name);
  const ready = validated.ok && !busy;

  async function create(): Promise<void> {
    if (!validated.ok || busy) {
      return;
    }
    setResult(null);
    setBusy(true);
    try {
      const outcome = await onCreate(validated.value);
      setResult(outcome);
      if (outcome.ok) {
        setName("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Kontrolne točke" data-checkpoints="">
      <form
        className="row"
        style={bar}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label htmlFor="checkpoint-name" style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          Naziv
        </label>
        <input
          id="checkpoint-name"
          className="input"
          style={field}
          value={name}
          maxLength={CHECKPOINT_NAME_MAX_LENGTH}
          placeholder="npr. Prije lekture"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="btn" disabled={!ready}>
          Kontrolna točka
        </button>
      </form>

      {result === null ? null : (
        <>
          <p style={message}>{result.message}</p>
          {result.ok && result.note !== null ? <p style={note}>{result.note}</p> : null}
        </>
      )}

      {/*
        Empty state (F1-9b): one short sentence. There is deliberately no
        action attached — a checkpoint is created by the form directly above
        this line, and a second button pointing at it would be noise.
      */}
      {checkpoints.length === 0 ? (
        <p style={note}>Nema kontrolnih točaka.</p>
      ) : (
        <ul style={list}>
          {checkpoints.map((checkpoint) => (
            <li key={checkpoint.id} style={{ overflowWrap: "anywhere" }}>
              {checkpoint.name} · revizija {checkpoint.revision} ·{" "}
              {formatCheckpointDate(checkpoint.createdAt)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
