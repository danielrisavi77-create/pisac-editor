import { describe, expect, it, vi } from "vitest";

// The middleware helper must never reach a real Supabase client in tests.
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => {
    throw new Error("createServerClient must not be called when unconfigured");
  }),
}));

import { NextRequest } from "next/server";

import { decideAccess } from "./guard";
import { refreshSession } from "./middleware";

describe("decideAccess", () => {
  it("allows a signed-in user into /workspace", () => {
    expect(
      decideAccess({ hasUser: true, isConfigured: true, pathname: "/workspace" }),
    ).toBe("allow");
  });

  it("allows a signed-in user into a nested workspace path", () => {
    expect(
      decideAccess({
        hasUser: true,
        isConfigured: true,
        pathname: "/workspace/dokument/1",
      }),
    ).toBe("allow");
  });

  it("redirects an anonymous visitor from /workspace to /prijava", () => {
    expect(
      decideAccess({ hasUser: false, isConfigured: true, pathname: "/workspace" }),
    ).toBe("redirect:/prijava");
  });

  it("redirects an anonymous visitor from a nested workspace path to /prijava", () => {
    expect(
      decideAccess({
        hasUser: false,
        isConfigured: true,
        pathname: "/workspace/dokument/1",
      }),
    ).toBe("redirect:/prijava");
  });

  it("redirects to /postavljanje when Supabase is not configured", () => {
    expect(
      decideAccess({ hasUser: false, isConfigured: false, pathname: "/workspace" }),
    ).toBe("redirect:/postavljanje");
  });

  it("prefers /postavljanje over /prijava even if a stale user is reported", () => {
    expect(
      decideAccess({ hasUser: true, isConfigured: false, pathname: "/workspace" }),
    ).toBe("redirect:/postavljanje");
  });

  it("allows the sign-in page in every combination", () => {
    for (const hasUser of [true, false]) {
      for (const isConfigured of [true, false]) {
        expect(decideAccess({ hasUser, isConfigured, pathname: "/prijava" })).toBe(
          "allow",
        );
      }
    }
  });

  it("does not treat a look-alike path as protected", () => {
    expect(
      decideAccess({
        hasUser: false,
        isConfigured: true,
        pathname: "/workspaces-public",
      }),
    ).toBe("allow");
  });
});

describe("refreshSession (unconfigured)", () => {
  it("reports no user and never builds a Supabase client", async () => {
    const request = new NextRequest("https://pisac.test/workspace");
    const result = await refreshSession(request);

    expect(result.isConfigured).toBe(false);
    expect(result.user).toBeNull();
    expect(result.response).toBeDefined();
  });
});
