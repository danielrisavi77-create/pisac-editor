/**
 * Workspace domain types and validators.
 *
 * Plain TypeScript: no Supabase, Next.js or React imports, so every branch is
 * unit-testable and reusable from both server actions and future clients.
 */

/** One personal workspace. F1 gives each user exactly one. */
export type Workspace = {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
};

/** An academic project ("rad") inside a workspace. */
export type Project = {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export const WORKSPACE_NAME_MAX_LENGTH = 120;
export const PROJECT_TITLE_MAX_LENGTH = 200;

/**
 * How many projects one workspace may hold (F1-10).
 *
 * `createProject` is an authenticated action, so this is not a spam gate: it
 * is a bound on what a single signed-in session — or a loop someone left
 * running — can do to the table and to a workspace page that renders every
 * row. A hundred academic works in one personal workspace is already far past
 * plausible use, which is what makes refusing at that point honest rather than
 * stingy.
 *
 * Enforced server-side in the action, on a counted read, not in the form.
 */
export const PROJECT_LIMIT = 100;

/** True when a workspace already holding `count` projects may not take another. */
export function exceedsProjectLimit(count: number): boolean {
  if (!Number.isFinite(count)) {
    // An uncountable workspace is not an empty one: refuse rather than let an
    // unknown count read as room.
    return true;
  }
  return count >= PROJECT_LIMIT;
}

/** Default name of the personal workspace created on first sign-in. */
export const DEFAULT_WORKSPACE_NAME = "Moj radni prostor";

export type ValidationFailureReason = "empty" | "too_long";

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; reason: ValidationFailureReason };

/**
 * Trim + length only. Inner whitespace is deliberately preserved: a title is
 * the author's, and collapsing it would silently rewrite their text.
 */
function validateText(input: string, maxLength: number): ValidationResult {
  const value = input.trim();
  if (value === "") {
    return { ok: false, reason: "empty" };
  }
  if ([...value].length > maxLength) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, value };
}

export function validateWorkspaceName(input: string): ValidationResult {
  return validateText(input, WORKSPACE_NAME_MAX_LENGTH);
}

export function validateProjectTitle(input: string): ValidationResult {
  return validateText(input, PROJECT_TITLE_MAX_LENGTH);
}

/** Codes carried through `?greska=` so the page can render one Croatian message. */
export type ActionErrorCode =
  | "naziv-prazan"
  | "naziv-dug"
  | "naziv-neispravan"
  | "previse-radova"
  | "spremanje"
  | "citanje";

export const ACTION_ERROR_MESSAGES: Record<ActionErrorCode, string> = {
  "naziv-prazan": "Upiši naziv rada.",
  "naziv-dug": `Naziv rada je predug (najviše ${PROJECT_TITLE_MAX_LENGTH} znakova).`,
  "naziv-neispravan": "Naziv rada nije ispravno poslan. Pokušaj ponovno.",
  "previse-radova": "Dosegnut je najveći broj radova.",
  spremanje: "Rad nije spremljen. Pokušaj ponovno.",
  citanje: "Radove trenutačno nije moguće dohvatiti.",
};

/**
 * Narrows an untrusted `?greska=` value to a known code.
 *
 * `in` would walk the prototype chain, so `?greska=constructor` or
 * `?greska=__proto__` would pass; only own keys are accepted. Next may also
 * hand us a repeated query parameter as an array, in which case the first
 * entry is considered and everything else rejected.
 */
export function parseActionErrorCode(
  raw: string | string[] | undefined,
): ActionErrorCode | null {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== "string") {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(ACTION_ERROR_MESSAGES, candidate)
    ? (candidate as ActionErrorCode)
    : null;
}

/** Control characters: C0, DEL and C1. Never part of a title an author typed. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/gu;

/**
 * Narrows an untrusted `?naziv=` value back into a title the create form can
 * pre-fill after a failed attempt.
 *
 * The point is only to hand the author their own words back, so this never
 * rejects: it strips control characters (which a title cannot contain and
 * which would otherwise travel through a redirect into the DOM), caps the
 * length at the same limit the validator enforces, and returns `""` when
 * there is nothing usable. Counting is by code point, like
 * `validateProjectTitle`, so a surrogate pair is never cut in half.
 *
 * It does NOT escape anything: the value is rendered as a React text
 * attribute, which escapes it, and pre-escaping here would show the author
 * `&amp;` where they typed `&`.
 */
export function sanitizeProjectTitleParam(
  raw: string | string[] | undefined,
): string {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== "string") {
    return "";
  }
  const stripped = candidate.replace(CONTROL_CHARACTERS, "");
  return [...stripped].slice(0, PROJECT_TITLE_MAX_LENGTH).join("");
}
