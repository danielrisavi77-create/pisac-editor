import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";

import { getSupabaseConfig } from "./config";

export type SessionRefreshResult = {
  response: NextResponse;
  user: User | null;
  isConfigured: boolean;
};

/**
 * Refreshes the Supabase session cookie for this request and reports the
 * current user. Never throws when Supabase is unconfigured — it simply
 * reports `isConfigured: false` and a pass-through response.
 */
export async function refreshSession(
  request: NextRequest,
): Promise<SessionRefreshResult> {
  let response = NextResponse.next({ request });

  const config = getSupabaseConfig();
  if (!config) {
    return { response, user: null, isConfigured: false };
  }

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Always use getUser() in middleware: it revalidates the token server-side.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user: user ?? null, isConfigured: true };
}
