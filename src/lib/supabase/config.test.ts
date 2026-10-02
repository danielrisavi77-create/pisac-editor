import { describe, expect, it } from "vitest";

import {
  getSiteUrl,
  getSupabaseConfig,
  isSupabaseConfigured,
  resolveAuthOrigin,
} from "./config";

describe("getSupabaseConfig", () => {
  it("returns null when no env vars are present", () => {
    expect(getSupabaseConfig({})).toBeNull();
  });

  it("returns null when only the URL is present", () => {
    expect(
      getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" }),
    ).toBeNull();
  });

  it("returns null when only a public key is present", () => {
    expect(
      getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable" }),
    ).toBeNull();
    expect(getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon" })).toBeNull();
  });

  it("returns null when a value is blank whitespace", () => {
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "   ",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
      }),
    ).toBeNull();
  });

  it("prefers the publishable key and trims both values", () => {
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: " https://x.supabase.co ",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " publishable-key ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: " legacy-anon ",
      }),
    ).toEqual({ url: "https://x.supabase.co", publicKey: "publishable-key" });
  });

  it("falls back to the legacy anon key when the publishable key is absent or blank", () => {
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: " legacy-anon ",
      }),
    ).toEqual({ url: "https://x.supabase.co", publicKey: "legacy-anon" });

    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "   ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon",
      }),
    ).toEqual({ url: "https://x.supabase.co", publicKey: "legacy-anon" });
  });
});

describe("isSupabaseConfigured", () => {
  it("is false without env vars", () => {
    expect(isSupabaseConfigured({})).toBe(false);
  });

  it("is true with the preferred publishable key", () => {
    expect(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      }),
    ).toBe(true);
  });

  it("remains true with the temporary legacy anon fallback", () => {
    expect(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon",
      }),
    ).toBe(true);
  });
});

describe("getSiteUrl", () => {
  it("is null when unset or blank", () => {
    expect(getSiteUrl({})).toBeNull();
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "  " })).toBeNull();
  });

  it("trims and strips trailing slashes", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: " https://pisac.hr/// " })).toBe(
      "https://pisac.hr",
    );
  });
});

describe("resolveAuthOrigin", () => {
  it("prefers the configured site URL over the request origin", () => {
    expect(resolveAuthOrigin("https://pisac.hr", "https://evil.example")).toBe(
      "https://pisac.hr",
    );
  });

  it("falls back to the request origin only when no site URL is set", () => {
    expect(resolveAuthOrigin(null, "http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("is null when neither origin can be determined", () => {
    expect(resolveAuthOrigin(null, null)).toBeNull();
    expect(resolveAuthOrigin("  ", "")).toBeNull();
  });
});
