import { NextResponse, type NextRequest } from "next/server";

import { RETURN_PARAM, decideAccess, sanitizeReturnPath } from "@/lib/supabase/guard";
import { carryCookies, refreshSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { response, user, isConfigured } = await refreshSession(request);

  const decision = decideAccess({
    hasUser: user !== null,
    isConfigured,
    pathname: request.nextUrl.pathname,
  });

  if (decision === "allow") {
    return response;
  }

  const target = request.nextUrl.clone();
  // The original query string is never carried: it belongs to the protected
  // page, not to the redirect, and may hold anything.
  target.search = "";

  if (decision === "redirect:/postavljanje") {
    target.pathname = "/postavljanje";
  } else if (decision === "redirect:/workspace") {
    target.pathname = "/workspace";
  } else {
    target.pathname = "/prijava";
    // Remember where the visitor was headed, but only when the ORIGINAL
    // pathname survives the allowlist — an unsanitised value here would be an
    // open redirect with a login screen in front of it.
    const returnPath = sanitizeReturnPath(request.nextUrl.pathname);
    if (returnPath) {
      target.searchParams.set(RETURN_PARAM, returnPath);
    }
  }

  // Keep the cookies the session refresh just wrote (rotated tokens, or
  // deletions on a rejected refresh) — a fresh redirect response has none.
  return carryCookies(response, NextResponse.redirect(target));
}

export const config = {
  // Deliberately narrow: never runs on /legacy or static assets.
  matcher: ["/workspace/:path*", "/d/:path*", "/prijava"],
};
