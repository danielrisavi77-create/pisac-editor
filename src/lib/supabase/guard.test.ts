import { describe, expect, it, vi } from "vitest";

// The middleware helper must never reach a real Supabase client in tests.
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => {
    throw new Error("createServerClient must not be called when unconfigured");
  }),
}));

import { NextRequest, NextResponse } from "next/server";

import {
  RETURN_PARAM,
  RETURN_PATH_MAX_LENGTH,
  decideAccess,
  sanitizeReturnPath,
} from "./guard";
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

  it("allows an anonymous visitor onto the sign-in page", () => {
    for (const isConfigured of [true, false]) {
      expect(
        decideAccess({ hasUser: false, isConfigured, pathname: "/prijava" }),
      ).toBe("allow");
    }
  });

  it("sends a signed-in visitor off /prijava to /workspace", () => {
    expect(
      decideAccess({ hasUser: true, isConfigured: true, pathname: "/prijava" }),
    ).toBe("redirect:/workspace");
  });

  it("keeps /prijava readable when a stale user is reported unconfigured", () => {
    // Unconfigured, /prijava is the page that explains why nothing works yet.
    expect(
      decideAccess({ hasUser: true, isConfigured: false, pathname: "/prijava" }),
    ).toBe("allow");
  });

  it("does not bounce a signed-in visitor off a look-alike public path", () => {
    for (const pathname of ["/prijavaX", "/prijava/nesto", "/"]) {
      expect(decideAccess({ hasUser: true, isConfigured: true, pathname })).toBe(
        "allow",
      );
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

describe("sanitizeReturnPath", () => {
  it("accepts the workspace root", () => {
    expect(sanitizeReturnPath("/workspace")).toBe("/workspace");
  });

  it("accepts a nested workspace path", () => {
    expect(sanitizeReturnPath("/workspace/dokument/1")).toBe("/workspace/dokument/1");
  });

  it("accepts a document route", () => {
    const path = "/d/8f14e45f-ceea-4671-aa11-1e4b1a2d0f0a";
    expect(sanitizeReturnPath(path)).toBe(path);
  });

  it("rejects a protocol-relative host", () => {
    expect(sanitizeReturnPath("//evil.com")).toBeNull();
    expect(sanitizeReturnPath("//evil.com/workspace")).toBeNull();
    expect(sanitizeReturnPath("/workspace//evil.com")).toBeNull();
  });

  it("rejects an absolute URL with a scheme", () => {
    expect(sanitizeReturnPath("https://x")).toBeNull();
    expect(sanitizeReturnPath("https://evil.com/workspace")).toBeNull();
    expect(sanitizeReturnPath("javascript:alert(1)")).toBeNull();
    expect(sanitizeReturnPath("/workspace:evil")).toBeNull();
  });

  it("rejects a backslash", () => {
    expect(sanitizeReturnPath("/\\x")).toBeNull();
    expect(sanitizeReturnPath("/\\\\evil.com")).toBeNull();
    expect(sanitizeReturnPath("/workspace\\..\\prijava")).toBeNull();
  });

  it("rejects percent-encoded separators rather than decoding them", () => {
    expect(sanitizeReturnPath("%2F%2Fevil.com")).toBeNull();
    expect(sanitizeReturnPath("/workspace%2F%2Fevil.com")).toBeNull();
    expect(sanitizeReturnPath("/d/%2e%2e%2fprijava")).toBeNull();
  });

  it("rejects dot segments", () => {
    expect(sanitizeReturnPath("/workspace/../prijava")).toBeNull();
    expect(sanitizeReturnPath("/workspace/./x")).toBeNull();
    expect(sanitizeReturnPath("/d/..")).toBeNull();
  });

  it("rejects a query string or fragment", () => {
    expect(sanitizeReturnPath("/workspace?x=1")).toBeNull();
    expect(sanitizeReturnPath("/workspace#x")).toBeNull();
  });

  it("rejects paths outside the two protected prefixes", () => {
    expect(sanitizeReturnPath("/prijava")).toBeNull();
    expect(sanitizeReturnPath("/postavljanje")).toBeNull();
    expect(sanitizeReturnPath("/")).toBeNull();
    expect(sanitizeReturnPath("/workspaces-public")).toBeNull();
    expect(sanitizeReturnPath("/dokumenti/1")).toBeNull();
    // Bare `/d` is not a page; only `/d/<id>` is.
    expect(sanitizeReturnPath("/d")).toBeNull();
    expect(sanitizeReturnPath("/d/")).toBeNull();
  });

  it("rejects a relative path with no leading slash", () => {
    expect(sanitizeReturnPath("workspace")).toBeNull();
    expect(sanitizeReturnPath("d/abc")).toBeNull();
  });

  it("considers only the first entry of a repeated parameter", () => {
    expect(sanitizeReturnPath(["/workspace", "//evil.com"])).toBe("/workspace");
    expect(sanitizeReturnPath(["//evil.com", "/workspace"])).toBeNull();
    expect(sanitizeReturnPath([])).toBeNull();
  });

  it("rejects non-string input, including prototype names", () => {
    expect(sanitizeReturnPath(undefined)).toBeNull();
    expect(sanitizeReturnPath("")).toBeNull();
    expect(sanitizeReturnPath("__proto__")).toBeNull();
    expect(sanitizeReturnPath("constructor")).toBeNull();
    expect(sanitizeReturnPath("/workspace/__proto__")).toBe("/workspace/__proto__");
    // A value forged as a number or object never becomes a path.
    expect(sanitizeReturnPath(42 as unknown as string)).toBeNull();
    expect(
      sanitizeReturnPath({ toString: () => "/workspace" } as unknown as string),
    ).toBeNull();
  });

  it("rejects an over-long path", () => {
    const longEnough = `/workspace/${"a".repeat(RETURN_PATH_MAX_LENGTH - 11)}`;
    expect(longEnough.length).toBe(RETURN_PATH_MAX_LENGTH);
    expect(sanitizeReturnPath(longEnough)).toBe(longEnough);
    expect(sanitizeReturnPath(`${longEnough}a`)).toBeNull();
  });

  it("rejects control characters and whitespace", () => {
    expect(sanitizeReturnPath("/workspace\n/x")).toBeNull();
    expect(sanitizeReturnPath("/workspace x")).toBeNull();
    expect(sanitizeReturnPath("/work\u0000space")).toBeNull();
  });
});

describe("middleware redirects", () => {
  async function runMiddleware(path: string, user: { id: string } | null) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");

    const { createServerClient } = await import("@supabase/ssr");
    vi.mocked(createServerClient).mockImplementation(
      () =>
        ({
          auth: { getUser: async () => ({ data: { user } }) },
        }) as never,
    );

    try {
      const { middleware } = await import("../../../middleware");
      return await middleware(new NextRequest(`https://pisac.test${path}`));
    } finally {
      // Restore the default: unconfigured tests must still fail loudly if a
      // real client is ever built.
      vi.mocked(createServerClient).mockImplementation(() => {
        throw new Error("createServerClient must not be called when unconfigured");
      });
      vi.unstubAllEnvs();
    }
  }

  it("appends the original pathname as the return target", async () => {
    const response = await runMiddleware("/d/abc?x=1", null);
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.pathname).toBe("/prijava");
    expect(location.searchParams.get(RETURN_PARAM)).toBe("/d/abc");
    // The protected page's own query string is not carried along.
    expect(location.searchParams.get("x")).toBeNull();
  });

  it("omits the return target when the pathname is not allowlisted", async () => {
    // Still protected (it starts with `/d/`), but percent-encoding never
    // survives the allowlist, so nothing is echoed back into the redirect.
    const response = await runMiddleware("/d/abc%20def", null);
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.pathname).toBe("/prijava");
    expect(location.searchParams.get(RETURN_PARAM)).toBeNull();
  });

  it("sends a signed-in visitor from /prijava to /workspace", async () => {
    const response = await runMiddleware("/prijava?poslano=1", { id: "u1" });
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.pathname).toBe("/workspace");
    expect(location.search).toBe("");
  });

  it("lets a signed-in visitor into a protected path untouched", async () => {
    const response = await runMiddleware("/workspace", { id: "u1" });
    expect(response.headers.get("location")).toBeNull();
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
