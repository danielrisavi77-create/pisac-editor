import { NextResponse, type NextRequest } from "next/server";

import { getSiteUrl, resolveAuthOrigin } from "@/lib/supabase/config";
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

  return NextResponse.redirect(`${origin ?? requestUrl.origin}/workspace`);
}
