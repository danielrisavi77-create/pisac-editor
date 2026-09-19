"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseConfig, isSupabaseConfigured } from "./config";

export { isSupabaseConfigured };

/**
 * Browser client, or `null` when the env vars are absent.
 * Callers must handle `null` — we never throw at import time.
 */
export function createClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config) {
    return null;
  }
  return createBrowserClient(config.url, config.anonKey);
}
