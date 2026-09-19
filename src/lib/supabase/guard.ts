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

export type GuardDecision = "allow" | "redirect:/prijava" | "redirect:/postavljanje";

export const SIGN_IN_PATH = "/prijava";
export const SETUP_PATH = "/postavljanje";
export const WORKSPACE_PATH = "/workspace";

function isProtected(pathname: string): boolean {
  return pathname === WORKSPACE_PATH || pathname.startsWith(`${WORKSPACE_PATH}/`);
}

export function decideAccess({
  hasUser,
  isConfigured,
  pathname,
}: GuardInput): GuardDecision {
  if (!isProtected(pathname)) {
    // Public paths (e.g. the sign-in page) are always reachable.
    return "allow";
  }
  if (!isConfigured) {
    // Nothing can be authenticated yet; point the operator at setup.
    return "redirect:/postavljanje";
  }
  return hasUser ? "allow" : "redirect:/prijava";
}
