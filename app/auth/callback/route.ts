import { NextResponse, type NextRequest } from "next/server";

import { getSiteUrl, resolveAuthOrigin } from "@/lib/supabase/config";
import { RETURN_PARAM, sanitizeReturnPath } from "@/lib/supabase/guard";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  // Pin the redirect target to the configured site URL when present; the
  // request origin (derived from headers) is only a development fallback.
  const origin = resolveAuthOrigin(getSiteUrl(), requestUrl.origin);
  const failure = origin
    ? `${origin}/prijava?greska=1`
    : `${requestUrl.origin}/prijava?greska=1`;

  const code = requestUrl.searchParams.get("code");
  if (!code) {
    console.error("[auth/callback] missing code parameter");
    return NextResponse.redirect(failure);
  }

  const supabase = await createClient();
  if (!supabase) {
    console.error("[auth/callback] Supabase is not configured");
    return NextResponse.redirect(failure);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth/callback] code exchange failed:", error.message);
    return NextResponse.redirect(failure);
  }

  // The link we mailed carried the path the author was headed for. It is
  // sanitized AGAIN here: the mailbox is not a trusted channel, and this
  // value is about to be concatenated onto our own origin. Anything that
  // does not survive the allowlist simply lands on /workspace.
  const returnPath =
    sanitizeReturnPath(requestUrl.searchParams.getAll(RETURN_PARAM)) ?? "/workspace";

  return NextResponse.redirect(`${origin ?? requestUrl.origin}${returnPath}`);
}
