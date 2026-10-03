import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

export type EvidenceShadowSessionResult =
  | { status: "ok"; user: User }
  | { status: "unconfigured" }
  | { status: "unauthenticated" };

export async function getEvidenceShadowSession(): Promise<EvidenceShadowSessionResult> {
  const supabase = await createClient();
  if (!supabase) return { status: "unconfigured" };

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || user.is_anonymous === true) {
    return { status: "unauthenticated" };
  }
  return { status: "ok", user };
}
