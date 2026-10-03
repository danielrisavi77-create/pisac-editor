/**
 * Env-driven Supabase configuration.
 *
 * Builds, lint, typecheck and tests must all pass when no live deployment env
 * is configured. This shared/browser config reads only public credentials.
 * Server-only secret/service-role credentials live in the dedicated
 * `src/lib/supabase/admin.ts` boundary and must never enter client bundles.
 *
 * New deployments should use Supabase's publishable key. The legacy anon key is
 * accepted only as a temporary compatibility fallback while existing
 * environments are migrated.
 */
export type SupabaseConfig = {
  url: string;
  publicKey: string;
};

type EnvSource = Record<string, string | undefined>;

function preferredPublicKey(publishable: string | undefined, legacyAnon: string | undefined): string {
  const current = publishable?.trim() ?? "";
  return current !== "" ? current : legacyAnon?.trim() ?? "";
}

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, so the property
 * accesses below must stay literal for the browser bundle to receive them.
 */
function readEnv(env?: EnvSource): SupabaseConfig {
  if (env) {
    return {
      url: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      publicKey: preferredPublicKey(
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    };
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    publicKey: preferredPublicKey(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

/** Returns the config, or `null` when either required public value is blank. */
export function getSupabaseConfig(env?: EnvSource): SupabaseConfig | null {
  const { url, publicKey } = readEnv(env);
  const trimmedUrl = url.trim();
  const trimmedPublicKey = publicKey.trim();
  if (trimmedUrl === "" || trimmedPublicKey === "") {
    return null;
  }
  return { url: trimmedUrl, publicKey: trimmedPublicKey };
}

/** Convenience guard for UI and route code. */
export function isSupabaseConfigured(env?: EnvSource): boolean {
  return getSupabaseConfig(env) !== null;
}

/**
 * Canonical public origin of this deployment, e.g. `https://pisac.example`.
 *
 * Optional. When set it pins the origin used for magic-link redirects, so an
 * attacker-controlled `Host` / `X-Forwarded-*` header cannot redirect the
 * sign-in link to another host. Unset is the dev case: the caller falls back
 * to the request origin.
 */
export function getSiteUrl(env?: EnvSource): string | null {
  const raw = (env ? env.NEXT_PUBLIC_SITE_URL : process.env.NEXT_PUBLIC_SITE_URL) ?? "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

/**
 * Pure origin resolution: the configured site URL wins, the request origin is
 * only a development fallback, and `null` means "refuse to build a link".
 */
export function resolveAuthOrigin(
  siteUrl: string | null,
  requestOrigin: string | null,
): string | null {
  const pinned = siteUrl?.trim().replace(/\/+$/, "") ?? "";
  if (pinned !== "") {
    return pinned;
  }
  const fallback = requestOrigin?.trim().replace(/\/+$/, "") ?? "";
  return fallback === "" ? null : fallback;
}
