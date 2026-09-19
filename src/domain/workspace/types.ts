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
export type ActionErrorCode = "naziv-prazan" | "naziv-dug" | "spremanje" | "citanje";

export const ACTION_ERROR_MESSAGES: Record<ActionErrorCode, string> = {
  "naziv-prazan": "Upiši naziv rada.",
  "naziv-dug": `Naziv rada je predug (najviše ${PROJECT_TITLE_MAX_LENGTH} znakova).`,
  spremanje: "Rad nije spremljen. Pokušaj ponovno.",
  citanje: "Radove trenutačno nije moguće dohvatiti.",
};

/** Narrows an untrusted `?greska=` value to a known code. */
export function parseActionErrorCode(raw: string | undefined): ActionErrorCode | null {
  return raw !== undefined && raw in ACTION_ERROR_MESSAGES ? (raw as ActionErrorCode) : null;
}
