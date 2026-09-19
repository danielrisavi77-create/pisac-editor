import { expect, test } from "@playwright/test";

/**
 * Fixture: FX-X-SEC-001 (F1-10).
 *
 * Two halves, and the second matters as much as the first. A CSP is easy to
 * assert and easy to get wrong in a way no assertion notices: a policy that
 * blocks the app's own scripts still returns the header this file checks. So
 * the same spec re-runs the demo's typing canary under the policy and fails on
 * any CSP violation the browser reports — if the policy were too strict, the
 * editor would not reach LOCAL_DURABLE and the console would say why.
 */

const EXPECTED_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.supabase.co",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

test.describe("security headers", () => {
  test("the landing page carries the CSP and the framing refusal", async ({ page }) => {
    const response = await page.goto("/");
    expect(response).not.toBeNull();

    const headers = response!.headers();
    expect(headers["content-security-policy"]).toBe(EXPECTED_CSP);
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  test("every route is covered, the static prototype included", async ({ page }) => {
    for (const path of ["/demo", "/prijava", "/legacy/index.html"]) {
      const response = await page.goto(path);
      expect(response, `no response for ${path}`).not.toBeNull();
      const headers = response!.headers();
      expect(headers["content-security-policy"], path).toBe(EXPECTED_CSP);
      expect(headers["x-frame-options"], path).toBe("DENY");
    }
  });

  /**
   * The canary. Typing on /demo exercises the hydrated client, the Tiptap
   * editor and an IndexedDB write — everything a too-strict script-src would
   * break — and the console is watched for the browser's own CSP refusals.
   */
  test("the demo still works under the policy, with no CSP violations", async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/Content Security Policy|Refused to (load|execute|apply|connect)/i.test(text)) {
        violations.push(text);
      }
    });
    page.on("pageerror", (error) => {
      violations.push(`pageerror: ${error.message}`);
    });

    await page.goto("/demo");
    await expect(page.locator(".tiptap[contenteditable='true']")).toBeVisible();

    const surface = page.locator(".tiptap");
    await surface.click();
    await surface.pressSequentially("Politika ne smije slomiti editor.", { delay: 10 });

    await expect(page.locator("[data-sync-state]")).toHaveAttribute(
      "data-sync-state",
      "LOCAL_DURABLE",
      { timeout: 3_000 },
    );

    expect(violations).toEqual([]);
  });
});
