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

  it("returns null when only the anon key is present", () => {
    expect(getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" })).toBeNull();
  });

  it("returns null when a value is blank whitespace", () => {
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "   ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      }),
    ).toBeNull();
  });

  it("returns trimmed values when both env vars are present", () => {
    expect(
      getSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: " https://x.supabase.co ",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: " anon-key ",
      }),
    ).toEqual({ url: "https://x.supabase.co", anonKey: "anon-key" });
  });
});

describe("isSupabaseConfigured", () => {
  it("is false without env vars", () => {
    expect(isSupabaseConfigured({})).toBe(false);
  });

  it("is true with both env vars", () => {
    expect(
      isSupabaseConfigured({
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
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
