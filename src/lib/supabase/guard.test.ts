import { describe, expect, it, vi } from "vitest";

// The middleware helper must never reach a real Supabase client in tests.
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => {
    throw new Error("createServerClient must not be called when unconfigured");
  }),
}));

import { NextRequest, NextResponse } from "next/server";

import { decideAccess } from "./guard";
import { carryCookies, refreshSession } from "./middleware";

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

  it("allows a signed-in user into a document route", () => {
    expect(
      decideAccess({
        hasUser: true,
        isConfigured: true,
        pathname: "/d/8f14e45f-ceea-4671-aa11-1e4b1a2d0f0a",
      }),
    ).toBe("allow");
  });

  it("redirects an anonymous visitor from a document route to /prijava", () => {
    expect(
      decideAccess({
        hasUser: false,
        isConfigured: true,
        pathname: "/d/8f14e45f-ceea-4671-aa11-1e4b1a2d0f0a",
      }),
    ).toBe("redirect:/prijava");
  });

  it("redirects an anonymous visitor from the bare /d to /prijava", () => {
    expect(decideAccess({ hasUser: false, isConfigured: true, pathname: "/d" })).toBe(
      "redirect:/prijava",
    );
  });

  it("sends an unconfigured deployment to /postavljanje from a document route", () => {
    expect(
      decideAccess({ hasUser: false, isConfigured: false, pathname: "/d/abc" }),
    ).toBe("redirect:/postavljanje");
  });

  it("does not treat /documents as the document route", () => {
    expect(
      decideAccess({ hasUser: false, isConfigured: true, pathname: "/documents" }),
    ).toBe("allow");
  });

  it("does not treat /dokumenti as the document route", () => {
    expect(
      decideAccess({ hasUser: false, isConfigured: true, pathname: "/dokumenti/1" }),
    ).toBe("allow");
  });

  it("protects a deeper document path", () => {
    expect(
      decideAccess({ hasUser: false, isConfigured: true, pathname: "/d/abc/verzije" }),
    ).toBe("redirect:/prijava");
  });
});

describe("middleware matcher", () => {
  it("covers every protected prefix the guard knows about", async () => {
    const { config } = await import("../../../middleware");
    expect(config.matcher).toContain("/workspace/:path*");
    expect(config.matcher).toContain("/d/:path*");
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

describe("carryCookies", () => {
  it("copies refreshed auth cookies onto a redirect response", () => {
    const refreshed = NextResponse.next();
    refreshed.cookies.set("sb-access-token", "rotated");
    refreshed.cookies.set("sb-refresh-token", "rotated-refresh");

    const redirect = carryCookies(
      refreshed,
      NextResponse.redirect("https://pisac.test/prijava"),
    );

    expect(redirect.cookies.get("sb-access-token")?.value).toBe("rotated");
    expect(redirect.cookies.get("sb-refresh-token")?.value).toBe("rotated-refresh");
  });

  it("leaves the redirect untouched when the refresh wrote no cookies", () => {
    const redirect = carryCookies(
      NextResponse.next(),
      NextResponse.redirect("https://pisac.test/prijava"),
    );

    expect(redirect.cookies.getAll()).toHaveLength(0);
  });
});
