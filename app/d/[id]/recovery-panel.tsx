"use client";

/**
 * The recovery panel (F1-5b): where a corrupt or unreadable local store stops
 * being a machine state and becomes a question the author answers.
 *
 * Rendered by `editor-client` whenever the sync state is RECOVERY_REQUIRED,
 * with the plan `attemptJournalRecovery` produced. Built on the same rules as
 * the conflict panel:
 *
 *   - It states what happened in one sentence, without blame: the local store
 *     is damaged. It does not guess why, and it never suggests the author did
 *     something wrong.
 *   - It offers exactly the options that are really available, each labelled
 *     with what it DOES, and each showing how much text it would keep — so
 *     "spasi moju lokalnu verziju" is a choice about a known quantity rather
 *     than a leap of faith.
 *   - An option that cannot be carried out is shown disabled WITH ITS REASON
 *     rather than hidden, and the server read can be retried. A recovery panel
 *     that quietly drops a button teaches the author nothing.
 *   - Nothing happens by itself. There is no automatic repair, no default and
 *     no timeout: both paths destroy one of two versions of the author's work,
 *     so both are explicit. The salvage path may have to delete and recreate
 *     the local database, and the panel says so before it is chosen.
 */

import { useState } from "react";

import type {
  RecoveryChoice,
  RecoveryOption,
  RecoveryPlan,
  RecoveryUnavailableReason,
} from "@/domain/sync";
import { blocksHr, wordsHr } from "@/lib/i18n/hr";

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

const note = {
  ...paragraph,
  color: "var(--muted)",
  fontSize: "0.9rem",
} as const;

/* Croatian number agreement is shared with the conflict panel (@/lib/i18n/hr). */

const CHOICE_LABELS: Record<RecoveryChoice, string> = {
  "salvage-local": "Spasi moju lokalnu verziju",
  "adopt-server": "Preuzmi verziju s poslužitelja",
};

/** Why a button is off. Stated plainly: a disabled button with no reason lies. */
const BLOCKED_REASONS: Record<RecoveryUnavailableReason, string> = {
  "journal-unreadable": "Lokalnu pohranu nije moguće pročitati.",
  "nothing-local": "U lokalnoj pohrani nema spremljenog teksta.",
  "local-unreadable": "Lokalni zapis nije u ispravnom obliku.",
  "server-unavailable": "Verzija s poslužitelja nije dohvaćena.",
};

function optionDescription(option: RecoveryOption): string {
  if (!option.available || option.candidate === null) {
    return option.blockedBy === null ? "" : BLOCKED_REASONS[option.blockedBy];
  }
  const { nodes, words: count } = option.candidate;
  return `${blocksHr(nodes)}, ${wordsHr(count)} · revizija ${option.candidate.revision}`;
}

export type RecoveryPanelProps = {
  plan: RecoveryPlan;
  /**
   * Applies the author's choice. Returns a Croatian message when it could not
   * be applied, or `null` on success — in which case this panel is about to be
   * unmounted, because the document has left RECOVERY_REQUIRED.
   */
  onChoose: (choice: RecoveryChoice) => Promise<string | null>;
  /** Re-reads the journal and the server, and rebuilds the plan. */
  onRetry: () => Promise<void>;
};

export default function RecoveryPanel({ plan, onChoose, onRetry }: RecoveryPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(kind: string, action: () => Promise<string | null>): Promise<void> {
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
    <section style={panel} aria-label="Oporavak lokalne pohrane" data-recovery-panel="">
      <h2 style={heading}>Lokalna pohrana nije čitljiva ili je oštećena.</h2>

      <p style={paragraph}>
        Ništa nije poslano na poslužitelj i ništa nije prebrisano. Odaberi koja
        verzija ide dalje.
      </p>

      {plan.recommended === null ? (
        <p style={paragraph}>
          Trenutačno nema nijedne verzije koju bismo mogli ponuditi. Pokušaj
          ponovno — poslužitelj je možda nedostupan samo nakratko.
        </p>
      ) : null}

      {problem === null ? null : <p style={paragraph}>{problem}</p>}

      <div className="row">
        {plan.options.map((option) => (
          <button
            key={option.choice}
            type="button"
            className="btn"
            disabled={!option.available || busy !== null}
            title={optionDescription(option)}
            data-recovery-choice={option.choice}
            onClick={() => void run(option.choice, () => onChoose(option.choice))}
          >
            {CHOICE_LABELS[option.choice]}
          </button>
        ))}

        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() =>
            void run("retry", async () => {
              await onRetry();
              return null;
            })
          }
        >
          Pokušaj ponovno
        </button>
      </div>

      <ul style={{ ...note, listStyle: "none", padding: 0, margin: "0.75rem 0 0" }}>
        {plan.options.map((option) => (
          <li key={option.choice}>
            {CHOICE_LABELS[option.choice]}: {optionDescription(option)}
          </li>
        ))}
      </ul>

      {plan.canSalvageLocal ? (
        <p style={note}>
          Spašavanje može zahtijevati ponovno stvaranje lokalne pohrane. U tom
          slučaju se briše sve što je u njoj ostalo, osim verzije koju spašavaš.
        </p>
      ) : null}
    </section>
  );
}
