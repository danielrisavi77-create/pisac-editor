"use client";

/**
 * The conflict panel (F1-5a): where a stale base stops being a machine state
 * and becomes a question the author answers.
 *
 * Rendered by `editor-client` whenever the sync state is CONFLICT, with the
 * unresolved conflict read back from the journal. It is deliberately small and
 * deliberately blunt:
 *
 *   - It states what happened in one sentence, without blame and without
 *     naming anybody: "Netko je spremio noviju verziju ovog dokumenta."
 *     Identity is not authorship, and this panel knows neither.
 *   - It offers exactly two ways out, both explicit, both labelled with what
 *     they DO rather than with a verdict: keep my version, or take the newer
 *     one. There is no "resolve automatically", no preselected default, no
 *     timeout, and no way to leave this panel by ignoring it.
 *   - It never claims a difference it has not checked. When the server's
 *     version could not be fetched, the discard button is disabled with the
 *     reason and a retry — because "adopt the newer version" is not an action
 *     that can be performed on a document we do not have.
 *
 * The component owns the decision (`resolveConflict`, pure domain) and nothing
 * else: applying it — journal writes, the state machine, the editor content —
 * is the caller's, through `onResolved`.
 *
 * `DegradedConflictPanel` below is the same question asked with less to go on,
 * for the case where the conflict is real but its record could not be read or
 * written. It exists so that CONFLICT is never a state without an exit.
 */

import { useState } from "react";

import {
  conflictSummary,
  resolveConflict,
  type ConflictRecord,
  type ConflictResolutionOk,
} from "@/domain/sync";

const panel = {
  border: "1px solid var(--fg)",
  borderRadius: "0.5rem",
  padding: "1rem 1.25rem",
  margin: "0.75rem 0",
} as const;

const heading = {
  margin: "0 0 0.5rem",
  fontSize: "1.05rem",
  fontWeight: 600,
} as const;

const paragraph = {
  margin: "0 0 0.75rem",
  lineHeight: 1.5,
} as const;

const counts = {
  display: "flex",
  flexWrap: "wrap",
  gap: "1.25rem",
  margin: "0 0 0.75rem",
  color: "var(--muted)",
  fontSize: "0.9rem",
} as const;

const choices = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.6rem",
} as const;

const choiceButton = {
  padding: "0.5rem 0.9rem",
  borderRadius: "0.4rem",
  border: "1px solid var(--fg)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
} as const;

const disabledButton = {
  ...choiceButton,
  borderColor: "var(--muted)",
  color: "var(--muted)",
  cursor: "not-allowed",
} as const;

/**
 * Croatian number agreement: 1 riječ, 2–4 riječi, 5+ riječi — with the 11–14
 * exception. Worth the six lines: "1 riječi" in a panel that is asking the
 * author to trust it is a small dishonesty about how carefully it was made.
 */
function plural(n: number, one: string, few: string, many: string): string {
  const lastTwo = Math.abs(n) % 100;
  const last = Math.abs(n) % 10;
  if (lastTwo >= 11 && lastTwo <= 14) {
    return `${n} ${many}`;
  }
  if (last === 1) {
    return `${n} ${one}`;
  }
  if (last >= 2 && last <= 4) {
    return `${n} ${few}`;
  }
  return `${n} ${many}`;
}

function blocks(n: number): string {
  return plural(n, "blok", "bloka", "blokova");
}

function words(n: number): string {
  return plural(n, "riječ", "riječi", "riječi");
}

type Busy = "rebase" | "discard" | "refresh" | null;

/**
 * The panel for a conflict whose record could not be read or written.
 *
 * The document is in CONFLICT — the server refused a commit and nothing may be
 * pushed over it — but the evidence is missing: `recordConflict` hit a full or
 * unavailable store, or the tab died between the write and the state. The one
 * thing this must never do is leave the author in a state with no exit, so it
 * offers the choice that needs no evidence: keeping their own text. Taking the
 * server's version genuinely cannot be offered here — there is no document to
 * take — so the retry, which re-reads the server, is what leads back to the
 * full panel.
 */
export function DegradedConflictPanel({
  onKeepMine,
  onRetry,
}: {
  onKeepMine: () => Promise<string | null>;
  onRetry: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(kind: Busy, action: () => Promise<string | null>): Promise<void> {
    if (busy !== null) {
      return;
    }
    setProblem(null);
    setBusy(kind);
    try {
      const failure = await action();
      if (failure) {
        setProblem(failure);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section style={panel} aria-label="Sukob verzija" data-conflict-panel="degraded">
      <h2 style={heading}>Netko je spremio noviju verziju.</h2>

      <p style={paragraph}>
        Pojedinosti nisu dostupne. Tvoj tekst je i dalje ovdje i ništa nije
        poslano na poslužitelj.
      </p>

      {problem === null ? null : <p style={paragraph}>{problem}</p>}

      <div style={choices}>
        <button
          type="button"
          style={busy === null ? choiceButton : disabledButton}
          disabled={busy !== null}
          onClick={() => void run("rebase", onKeepMine)}
        >
          Zadrži moju verziju
        </button>

        <button
          type="button"
          style={busy === null ? choiceButton : disabledButton}
          disabled={busy !== null}
          onClick={() =>
            void run("refresh", async () => {
              await onRetry();
              return null;
            })
          }
        >
          Pokušaj ponovno
        </button>
      </div>
    </section>
  );
}

export type ConflictPanelProps = {
  /** The unresolved conflict, as the journal recorded it. */
  record: ConflictRecord;
  /**
   * Applies the author's decision. Returns a Croatian message when it could
   * not be applied (a local store that refused the write), or `null` on
   * success — in which case this panel is about to be unmounted, because the
   * document has left CONFLICT.
   */
  onResolved: (outcome: ConflictResolutionOk) => Promise<string | null>;
  /** Re-fetches the server's version for a conflict that is missing it. */
  onRefresh: () => Promise<void>;
};

export default function ConflictPanel({
  record,
  onResolved,
  onRefresh,
}: ConflictPanelProps) {
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const summary = conflictSummary(record);

  async function choose(via: "rebase" | "discard"): Promise<void> {
    if (busy !== null) {
      return;
    }
    setProblem(null);

    const decision = resolveConflict(record, via);
    if (!decision.ok) {
      // The only reason reachable from the UI: the discard button is disabled
      // while the server's version is unknown, so this is a belt-and-braces
      // message rather than an expected path.
      setProblem(
        decision.reason === "server-unknown"
          ? "Novija verzija nije dohvaćena. Pokušaj ponovno."
          : "Ovaj sukob je već razriješen.",
      );
      return;
    }

    setBusy(via);
    try {
      const failure = await onResolved(decision);
      if (failure) {
        setProblem(failure);
      }
    } finally {
      setBusy(null);
    }
  }

  async function refresh(): Promise<void> {
    if (busy !== null) {
      return;
    }
    setProblem(null);
    setBusy("refresh");
    try {
      await onRefresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section style={panel} aria-label="Sukob verzija" data-conflict-panel="">
      <h2 style={heading}>Netko je spremio noviju verziju ovog dokumenta.</h2>

      <p style={paragraph}>
        Ništa nije prebrisano i ništa nije izgubljeno. Obje verzije su
        zabilježene, a na tebi je da odabereš koja ide dalje.
      </p>

      <div style={counts}>
        <span>
          Moja verzija: {blocks(summary.local.nodes)}, {words(summary.local.words)}
        </span>
        {summary.server ? (
          <span>
            Novija verzija: {blocks(summary.server.nodes)}, {words(summary.server.words)}
          </span>
        ) : (
          <span>Novija verzija: nepoznata</span>
        )}
      </div>

      {summary.contentEqual ? (
        /*
         * A shortcut for the eye, never for the machine: the author still has
         * to choose. "Identical text" is not "no decision needed" — the node
         * identities differ, and which of the two becomes canonical is exactly
         * what the two buttons below decide.
         */
        <p style={paragraph}>Sadržaj je identičan.</p>
      ) : null}

      {summary.serverAvailable ? null : (
        <p style={paragraph}>Novija verzija nije dohvaćena. Pokušaj ponovno.</p>
      )}

      {problem === null ? null : <p style={paragraph}>{problem}</p>}

      <div style={choices}>
        <button
          type="button"
          style={busy === null ? choiceButton : disabledButton}
          disabled={busy !== null}
          onClick={() => void choose("rebase")}
        >
          Zadrži moju verziju
        </button>

        <button
          type="button"
          style={summary.serverAvailable && busy === null ? choiceButton : disabledButton}
          // Not a preference: without the server's document there is literally
          // nothing to adopt.
          disabled={!summary.serverAvailable || busy !== null}
          title={
            summary.serverAvailable
              ? undefined
              : "Novija verzija nije dohvaćena. Pokušaj ponovno."
          }
          onClick={() => void choose("discard")}
        >
          Preuzmi noviju verziju
        </button>

        {summary.serverAvailable ? null : (
          <button
            type="button"
            style={busy === null ? choiceButton : disabledButton}
            disabled={busy !== null}
            onClick={() => void refresh()}
          >
            Pokušaj ponovno
          </button>
        )}
      </div>
    </section>
  );
}
