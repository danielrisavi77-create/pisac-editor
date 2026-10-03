import { describe, expect, it } from "vitest";

import { getSupabaseAdminConfig } from "./admin";

describe("Supabase admin configuration", () => {
  it("prefers the modern secret key", () => {
    expect(
      getSupabaseAdminConfig({
        NEXT_PUBLIC_SUPABASE_URL: " https://example.supabase.co ",
        SUPABASE_SECRET_KEY: " sb_secret_current ",
        SUPABASE_SERVICE_ROLE_KEY: "legacy",
      }),
    ).toEqual({
      url: "https://example.supabase.co",
      secretKey: "sb_secret_current",
    });
  });

  it("allows the legacy service-role key only as a fallback", () => {
    expect(
      getSupabaseAdminConfig({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: " ",
        SUPABASE_SERVICE_ROLE_KEY: " legacy-service-role ",
      }),
    ).toEqual({
      url: "https://example.supabase.co",
      secretKey: "legacy-service-role",
    });
  });

  it("fails closed when either server URL or secret is missing", () => {
    expect(getSupabaseAdminConfig({})).toBeNull();
    expect(
      getSupabaseAdminConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toBeNull();
    expect(
      getSupabaseAdminConfig({
        SUPABASE_SECRET_KEY: "sb_secret_x",
      }),
    ).toBeNull();
  });
});
