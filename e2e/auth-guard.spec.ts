import { expect, test } from "@playwright/test";

/**
 * Fixtures: FX-FR-001-001 (partial), FX-X-SEC-001 (partial).
 *
 * The app under test is UNCONFIGURED: no NEXT_PUBLIC_SUPABASE_* env vars exist,
 * so `decideAccess` (src/lib/supabase/guard.ts) sends every protected path to
 * /postavljanje. That proves the guard is wired into middleware.ts and that no
 * protected surface renders without a session — it does NOT prove the
 * authenticated branches, which stay BLOCKED until the Supabase project is
 * restored (see e2e/EVIDENCE.md).
 */
test.describe("auth guard, unconfigured deployment", () => {
  test("/workspace never renders; it redirects to /postavljanje", async ({
    page,
  }) => {
    await page.goto("/workspace");

    await expect(page).toHaveURL(/\/postavljanje$/);
    await expect(page.locator("h1")).toHaveText("Postavljanje");
  });

  test("a document route redirects the same way", async ({ page }) => {
    await page.goto("/d/anything");

    await expect(page).toHaveURL(/\/postavljanje$/);
    await expect(page.locator("h1")).toHaveText("Postavljanje");
  });

  test("a query string on a protected path is not carried into the redirect", async ({
    page,
  }) => {
    await page.goto("/workspace?next=%2Fd%2Fsecret");

    await expect(page).toHaveURL("http://localhost:3000/postavljanje");
  });

  test("/prijava stays reachable and states the unconfigured truth", async ({
    page,
  }) => {
    await page.goto("/prijava");

    await expect(page.locator("h1")).toHaveText("Prijava");
    await expect(
      page.getByText("Supabase još nije konfiguriran."),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Upute za postavljanje" }),
    ).toHaveAttribute("href", "/postavljanje");
    // No sign-in form is offered while it cannot possibly work.
    await expect(page.locator("form")).toHaveCount(0);
  });

  test("/postavljanje names both required env vars and no secret value", async ({
    page,
  }) => {
    await page.goto("/postavljanje");

    await expect(
      page.getByText("NEXT_PUBLIC_SUPABASE_URL", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("NEXT_PUBLIC_SUPABASE_ANON_KEY", { exact: true }),
    ).toBeVisible();
    // The setup page must never leak a service role key or a project URL.
    await expect(page.locator("body")).not.toContainText("SERVICE_ROLE");
    await expect(page.locator("body")).not.toContainText("supabase.co");
  });
});
