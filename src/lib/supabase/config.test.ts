import { describe, expect, it } from "vitest";

import { getSupabaseConfig, isSupabaseConfigured } from "./config";

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
