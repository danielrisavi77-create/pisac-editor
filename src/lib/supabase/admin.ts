import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseAdminConfig = {
  url: string;
  secretKey: string;
};

type EnvSource = Record<string, string | undefined>;

function preferredSecret(
  modernSecret: string | undefined,
  legacyServiceRole: string | undefined,
): string {
  const modern = modernSecret?.trim() ?? "";
  return modern !== "" ? modern : legacyServiceRole?.trim() ?? "";
}

export function getSupabaseAdminConfig(
  env: EnvSource = process.env,
): SupabaseAdminConfig | null {
  const url = (
    env.SUPABASE_URL ??
    env.NEXT_PUBLIC_SUPABASE_URL ??
    ""
  ).trim();
  const secretKey = preferredSecret(
    env.SUPABASE_SECRET_KEY,
    env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (url === "" || secretKey === "") return null;
  return { url, secretKey };
}

/**
 * Server-only administrative client.
 *
 * Never import this module from a Client Component. The secret key bypasses
 * RLS and is intentionally not a NEXT_PUBLIC_* variable.
 */
export function createAdminClient(
  env: EnvSource = process.env,
): SupabaseClient | null {
  if (typeof window !== "undefined") {
    throw new Error("Supabase admin client is server-only");
  }

  const config = getSupabaseAdminConfig(env);
  if (!config) return null;

  return createSupabaseClient(config.url, config.secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
