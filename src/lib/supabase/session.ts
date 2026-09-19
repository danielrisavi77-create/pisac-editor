import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createClient } from "./server";

/**
 * The one session round trip a server request is allowed to pay.
 *
 * Every guarded page and every server action needs the same three steps — a
 * configured client, a revalidated user, and a redirect when either is
 * missing — and each had its own copy of them before F1-13. Having one copy
 * is what keeps the two redirect targets from drifting apart: an
 * unconfigured deployment must land on `/postavljanje` (the page that
 * explains why nothing works yet) and only a missing session may send someone
 * to `/prijava`.
 *
 * Callers take the client AND the user from here rather than calling
 * `getUser()` again: a page that resolves the session once and hands the
 * client to its queries pays one round trip instead of one per helper (F1-9a).
 *
 * `redirect()` never returns, so what comes back is always a real session.
 */
export type ServerSession = {
  supabase: SupabaseClient;
  user: User;
};

export async function requireSession(): Promise<ServerSession> {
  const supabase = await createClient();
  if (!supabase) {
    redirect("/postavljanje");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/prijava");
  }

  return { supabase, user };
}
