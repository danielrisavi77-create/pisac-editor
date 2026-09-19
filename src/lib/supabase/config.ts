/**
 * Env-driven Supabase configuration.
 *
 * No Supabase project exists yet, so nothing here may throw at import time:
 * builds, lint, typecheck and tests must all pass with no env vars set.
 * Only the two public (anon) values are ever read. The service role key is
 * server-only and must never be referenced from `src/` or `app/`.
 */
export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

type EnvSource = Record<string, string | undefined>;

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, so the property
 * accesses below must stay literal for the browser bundle to receive them.
 */
function readEnv(env?: EnvSource): SupabaseConfig {
  if (env) {
    return {
      url: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    };
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
}

/** Returns the config, or `null` when either env var is missing/blank. */
export function getSupabaseConfig(env?: EnvSource): SupabaseConfig | null {
  const { url, anonKey } = readEnv(env);
  const trimmedUrl = url.trim();
  const trimmedAnonKey = anonKey.trim();
  if (trimmedUrl === "" || trimmedAnonKey === "") {
    return null;
  }
  return { url: trimmedUrl, anonKey: trimmedAnonKey };
}

/** Convenience guard for UI and route code. */
export function isSupabaseConfigured(env?: EnvSource): boolean {
  return getSupabaseConfig(env) !== null;
}
