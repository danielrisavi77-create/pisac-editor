/**
 * The F1 sync state machine (dossier §7, F1 plan §3), as a pure reducer.
 *
 * Pure domain: no React, no Dexie, no IO, no clock. The reducer is a total
 * function over (state, event) — it never throws and never returns
 * `undefined`. Everything that *does* something (writing IndexedDB, talking to
 * the server) lives outside and only reports back through events.
 *
 * Constitution rules this file encodes:
 *   - Local durable state is not canonical server state: LOCAL_DURABLE and
 *     SYNCED are two different states and one never stands in for the other.
 *   - There is never a generic "Saved": the eight states below are the whole
 *     vocabulary, and the UI (F1-3b) maps each one to its own Croatian label.
 *   - No silent last-write-wins: a stale base puts the document in CONFLICT,
 *     which can only be left by an explicit `CONFLICT_RESOLVED` decision.
 *   - Unrecoverable local storage failure is not an ordinary error: it lands
 *     in RECOVERY_REQUIRED, which can only be left by `RECOVERED`.
 */

/** The eight user-visible states. No ninth state, no implicit "saved". */
export const SYNC_STATES = [
  "EDITING",
  "SAVING_LOCAL",
  "LOCAL_DURABLE",
  "SYNCING",
  "SYNCED",
  "CONFLICT",
  "ERROR",
  "RECOVERY_REQUIRED",
] as const;

export type SyncState = (typeof SYNC_STATES)[number];

/** Why an atomic local transaction failed. Drives ERROR vs RECOVERY_REQUIRED. */
export const LOCAL_SAVE_FAILURE_REASONS = [
  "quota",
  "unavailable",
  "corrupt",
  "unknown",
] as const;

export type LocalSaveFailureReason = (typeof LOCAL_SAVE_FAILURE_REASONS)[number];

/** How the author chose to resolve a conflict. Always explicit, never implied. */
export const CONFLICT_RESOLUTIONS = ["rebase", "discard"] as const;

export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

export type SyncEvent =
  /** A new canonical candidate exists — the author changed the document. */
  | { type: "EDIT" }
  /** The atomic IndexedDB transaction is in flight. */
  | { type: "LOCAL_SAVE_STARTED" }
  /** The atomic IndexedDB transaction committed. */
  | { type: "LOCAL_SAVE_OK" }
  /** The atomic IndexedDB transaction failed; `reason` decides the state. */
  | { type: "LOCAL_SAVE_FAILED"; reason: LocalSaveFailureReason }
  /** A pending entry was handed to the server CAS (F1-4). */
  | { type: "SYNC_STARTED" }
  /** The server accepted the CAS and assigned a canonical revision. */
  | { type: "SYNC_ACK" }
  /** The server rejected the CAS: the local base revision is stale. */
  | { type: "SYNC_STALE_BASE" }
  /**
   * Transport or server failure. `retryable` is carried for the retry policy
   * (F1-4b backoff), not for the state: a failed sync is ERROR either way,
   * because a server that is merely unreachable has not corrupted anything
   * local and must not be dressed up as RECOVERY_REQUIRED.
   */
  | { type: "SYNC_FAILED"; retryable: boolean }
  /** The author explicitly chose to rebase or to discard the local change. */
  | { type: "CONFLICT_RESOLVED"; via: ConflictResolution }
  /** The recovery flow restored the journal from a checkpoint (F1-5b). */
  | { type: "RECOVERED" };

export type SyncEventType = SyncEvent["type"];

export const SYNC_EVENT_TYPES = [
  "EDIT",
  "LOCAL_SAVE_STARTED",
  "LOCAL_SAVE_OK",
  "LOCAL_SAVE_FAILED",
  "SYNC_STARTED",
  "SYNC_ACK",
  "SYNC_STALE_BASE",
  "SYNC_FAILED",
  "CONFLICT_RESOLVED",
  "RECOVERED",
] as const satisfies readonly SyncEventType[];

/**
 * One cell of the transition table. Either a fixed target state, or — for the
 * three events that carry a payload — a target per payload variant.
 *
 * Kept as data rather than as a function so tests can enumerate the whole
 * table exhaustively instead of re-implementing the reducer's own branches.
 */
export type SyncTransition =
  | { readonly to: SyncState }
  | { readonly cases: Readonly<Record<string, SyncState>> };

export type SyncTransitionRow = Readonly<Partial<Record<SyncEventType, SyncTransition>>>;

/**
 * THE transition table. Anything absent from a row is an illegal transition
 * for that state and leaves the state unchanged (see `syncReducer`).
 *
 * Reading notes:
 *   - `EDIT` is legal from every state except CONFLICT and RECOVERY_REQUIRED.
 *     A fresh candidate means the previous LOCAL_DURABLE/SYNCED claim is no
 *     longer true of what the author is looking at, and EDITING is the only
 *     honest answer; claiming durability for unsaved text is the exact failure
 *     the constitution forbids. CONFLICT and RECOVERY_REQUIRED swallow it:
 *     those two demand an explicit decision and typing is not one.
 *   - A local save begins either from EDITING (a candidate is waiting) or from
 *     ERROR (an explicit retry). It never begins from LOCAL_DURABLE/SYNCED,
 *     because there would be nothing new to write.
 *   - ERROR is not sticky. It is left by a retry (LOCAL_SAVE_STARTED /
 *     SYNC_STARTED) or by a new edit; a failure that repeats simply re-enters
 *     ERROR through SAVING_LOCAL. Only CONFLICT and RECOVERY_REQUIRED are
 *     sticky, and each has exactly one exit.
 *   - `LOCAL_SAVE_FAILED` escalates to RECOVERY_REQUIRED for 'corrupt' ONLY.
 *     A corrupt store means the bytes on disk can no longer be trusted and a
 *     checkpoint restore is the only way out. 'unavailable' is deliberately an
 *     ordinary ERROR: a browser that refuses IndexedDB (private window, site
 *     data blocked) is not damaged, and RECOVERY_REQUIRED there would be a
 *     trap — the recovery flow itself needs a working store to leave it.
 *     'quota' and 'unknown' are likewise ordinary, retryable failures.
 */
export const SYNC_TRANSITIONS: Readonly<Record<SyncState, SyncTransitionRow>> = {
  EDITING: {
    EDIT: { to: "EDITING" },
    LOCAL_SAVE_STARTED: { to: "SAVING_LOCAL" },
  },
  SAVING_LOCAL: {
    EDIT: { to: "EDITING" },
    LOCAL_SAVE_OK: { to: "LOCAL_DURABLE" },
    LOCAL_SAVE_FAILED: {
      cases: {
        quota: "ERROR",
        unknown: "ERROR",
        unavailable: "ERROR",
        corrupt: "RECOVERY_REQUIRED",
      },
    },
  },
  LOCAL_DURABLE: {
    EDIT: { to: "EDITING" },
    SYNC_STARTED: { to: "SYNCING" },
  },
  SYNCING: {
    EDIT: { to: "EDITING" },
    SYNC_ACK: { to: "SYNCED" },
    SYNC_STALE_BASE: { to: "CONFLICT" },
    SYNC_FAILED: { cases: { true: "ERROR", false: "ERROR" } },
  },
  SYNCED: {
    EDIT: { to: "EDITING" },
  },
  CONFLICT: {
    /*
     * A rebase produces NEW content (the local change replayed on the server's
     * base), and new content goes through the journal before it goes to the
     * server — hence SAVING_LOCAL, not straight back to SYNCING. Resubmitting
     * something that was never made durable would mean a crash mid-rebase
     * loses work the author already saw resolved.
     *
     * A discard drops the local change, so what remains is exactly the
     * server's canonical revision: SYNCED.
     *
     * The obligations both paths carry are discharged outside this table, by
     * the editor (F1-5a): a rebase journals the re-based document against the
     * server's revision before this transition is dispatched, and a discard
     * clears the abandoned queue and adopts the server's document in one
     * journal transaction — without which the SYNCED claim above would not be
     * honest. The conflict itself is recorded before either, and survives its
     * own resolution (`src/domain/sync/conflict.ts`).
     */
    CONFLICT_RESOLVED: { cases: { rebase: "SAVING_LOCAL", discard: "SYNCED" } },
  },
  ERROR: {
    EDIT: { to: "EDITING" },
    LOCAL_SAVE_STARTED: { to: "SAVING_LOCAL" },
    SYNC_STARTED: { to: "SYNCING" },
  },
  RECOVERY_REQUIRED: {
    RECOVERED: { to: "EDITING" },
  },
};

/**
 * The payload value that selects a variant, for the three events that have
 * one. `null` for the plain events, whose transitions are payload-free.
 *
 * Exported so tests can enumerate (state, event, variant) without hardcoding
 * the discriminating field names a second time.
 */
export function transitionVariant(event: SyncEvent): string | null {
  switch (event.type) {
    case "LOCAL_SAVE_FAILED":
      return event.reason;
    case "SYNC_FAILED":
      return String(event.retryable);
    case "CONFLICT_RESOLVED":
      return event.via;
    default:
      return null;
  }
}

/**
 * The sync state machine. Total: every (state, event) pair has an answer, and
 * an illegal pair returns `state` unchanged rather than throwing — a stray
 * late ACK or a duplicated retry must never crash an editor session, and must
 * never be allowed to invent a state the pipeline did not reach.
 *
 * Shaped as `(state, event) => state` so it can be handed straight to React's
 * `useReducer` without an adapter.
 */
/**
 * Table lookup that only ever sees the table's OWN entries.
 *
 * Plain property access would walk the prototype chain, so an event carrying
 * `type: "toString"` or `reason: "constructor"` — a string that reaches the
 * machine from stored JSON or a future message channel — would find an
 * inherited `Object.prototype` member and be treated as a transition. Every
 * lookup here is therefore an own-property lookup.
 */
function ownTransition(state: SyncState, event: SyncEvent): SyncTransition | null {
  if (!Object.hasOwn(SYNC_TRANSITIONS, state)) {
    return null;
  }
  const row = SYNC_TRANSITIONS[state];
  if (!Object.hasOwn(row, event.type)) {
    return null;
  }
  return row[event.type] ?? null;
}

function ownVariantTarget(
  transition: SyncTransition,
  event: SyncEvent,
): SyncState | null {
  if ("to" in transition) {
    return transition.to;
  }
  const variant = transitionVariant(event);
  if (variant === null || !Object.hasOwn(transition.cases, variant)) {
    return null;
  }
  return transition.cases[variant];
}

export function syncReducer(state: SyncState, event: SyncEvent): SyncState {
  const transition = ownTransition(state, event);
  if (!transition) {
    return state;
  }
  return ownVariantTarget(transition, event) ?? state;
}

/** True when `event` moves `state` at all (a self-transition counts as legal). */
export function isLegalTransition(state: SyncState, event: SyncEvent): boolean {
  const transition = ownTransition(state, event);
  return transition !== null && ownVariantTarget(transition, event) !== null;
}

/** The state a fresh editor session starts in: nothing is claimed yet. */
export const INITIAL_SYNC_STATE: SyncState = "EDITING";
