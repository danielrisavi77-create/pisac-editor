"use client";

/**
 * The sync status chip (F1-3b): the one place the author learns what is true
 * about their text right now.
 *
 * Deliberately dumb. Every decision — the wording, the tone, and the rule that
 * a blocked tab reports being blocked instead of reporting a state it is not
 * driving — lives in `@/domain/sync/labels` as pure data, so it is tested
 * without a DOM. This file only turns that into markup.
 *
 * Accessibility notes:
 *   - `role="status"` with `aria-live="polite"` announces each change without
 *     interrupting typing. The dot is `aria-hidden`: colour carries no
 *     information that the label does not already spell out, which is also why
 *     the tone palette may repeat while the labels never do.
 *   - The pulse on in-flight states is a CSS decoration and is switched off
 *     under `prefers-reduced-motion` (see app/globals.css).
 */

import { chipContent, type SyncState } from "@/domain/sync";

export type SyncStatusChipProps = {
  /** The reducer's current state. */
  state: SyncState;
  /** True when another tab holds the writer lock; overrides `state`. */
  blocked?: boolean;
};

export default function SyncStatusChip({ state, blocked = false }: SyncStatusChipProps) {
  const { text, tone } = chipContent(state, blocked);

  return (
    <span
      className="sync-chip"
      data-tone={tone}
      data-testid="sync-state"
      role="status"
      aria-live="polite"
    >
      <span className="sync-chip__dot" aria-hidden="true" />
      {text}
    </span>
  );
}
