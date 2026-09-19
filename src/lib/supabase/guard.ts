/**
 * Pure routing decision for the auth middleware.
 *
 * Kept free of Next.js and Supabase imports so every branch is unit-testable.
 */
export type GuardInput = {
  hasUser: boolean;
  isConfigured: boolean;
  pathname: string;
};

export type GuardDecision =
  | "allow"
  | "redirect:/prijava"
  | "redirect:/postavljanje"
  | "redirect:/workspace";

export const SIGN_IN_PATH = "/prijava";
export const SETUP_PATH = "/postavljanje";
export const WORKSPACE_PATH = "/workspace";
/** Document editor route: `/d/<project id>`. */
export const DOCUMENT_PATH = "/d";

/** Query parameter carrying the path to return to after a successful sign-in. */
export const RETURN_PARAM = "dalje";

/** Longest return path we will carry. Real targets are far shorter. */
export const RETURN_PATH_MAX_LENGTH = 200;

/**
 * One path segment of an acceptable return target.
 *
 * A strict allowlist of characters rather than a denylist of dangerous ones:
 * `%` is absent, so a percent-encoded separator (`%2F%2F`, `%5C`) can never
 * survive to be decoded by something downstream, and so are `:`, `\` and the
 * empty segment that `//evil.com` needs. No legitimate target needs any of
 * them — a project id is a uuid.
 */
const SEGMENT = "[A-Za-z0-9._~@-]+";

/**
 * `/workspace`, `/workspace/<segments>` or `/d/<segment>[/<segments>]`.
 *
 * Anchored at both ends, so a scheme (`https://x`), a protocol-relative host
 * (`//evil.com`), a backslash (`/\x`) or a query/fragment cannot appear.
 */
const RETURN_PATH_PATTERN = new RegExp(
  `^(?:${WORKSPACE_PATH}|${DOCUMENT_PATH}/${SEGMENT})(?:/${SEGMENT})*$`,
);

/**
 * Narrows an untrusted return-to value to a same-origin path we are willing
 * to redirect to after sign-in, or `null`.
 *
 * Everything about the input is hostile until proven otherwise: it arrives in
 * a query string, may be repeated (Next then hands us an array), and is later
 * concatenated onto an origin. Only the first entry of a repeated parameter
 * is considered, and it must match the allowlist above whole.
 *
 * Dot segments are rejected separately: `..` is spelled with allowlisted
 * characters, and `/workspace/../prijava` is not the path it appears to be.
 */
export function sanitizeReturnPath(
  raw: string | string[] | undefined,
): string | null {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== "string") {
    return null;
  }
  if (candidate.length === 0 || candidate.length > RETURN_PATH_MAX_LENGTH) {
    return null;
  }
  if (!RETURN_PATH_PATTERN.test(candidate)) {
    return null;
  }
  if (candidate.split("/").some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return candidate;
}

/**
 * Prefixes that require a session. Matching is on a whole path segment, so
 * `/documents` is not `/d` and `/workspaces-public` is not `/workspace`.
 */
const PROTECTED_PREFIXES = [WORKSPACE_PATH, DOCUMENT_PATH] as const;

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function decideAccess({
  hasUser,
  isConfigured,
  pathname,
}: GuardInput): GuardDecision {
  if (!isProtected(pathname)) {
    // Someone who is already signed in has nothing to do on the sign-in page;
    // send them to their workspace instead of offering a second sign-in.
    // Only when Supabase is configured: unconfigured, /prijava is the page
    // that explains why nothing can work yet, and must stay readable.
    if (pathname === SIGN_IN_PATH && isConfigured && hasUser) {
      return "redirect:/workspace";
    }
    // Public paths are otherwise always reachable.
    return "allow";
  }
  if (!isConfigured) {
    // Nothing can be authenticated yet; point the operator at setup.
    return "redirect:/postavljanje";
  }
  return hasUser ? "allow" : "redirect:/prijava";
}
