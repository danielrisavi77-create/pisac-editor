import { expect, test } from "@playwright/test";

/**
 * Fixtures: FX-X-CLIENT-001 (partial).
 *
 * What this can prove without Supabase: the Next shell renders and the vanilla
 * prototype is still served from /legacy/ with its assets intact. Everything
 * behind the auth guard (documents, journal, sync) needs a live project and is
 * recorded as BLOCKED in e2e/EVIDENCE.md — it is not simulated here.
 */
test.describe("landing and prototype", () => {
  test("landing renders the Pisač shell with both entry points", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toHaveText("Pisač");
    await expect(page.getByRole("link", { name: "Prijava" })).toHaveAttribute(
      "href",
      "/prijava",
    );
    await expect(
      page.getByRole("link", { name: "Otvori prototip" }),
    ).toHaveAttribute("href", "/legacy/");
  });

  test("the Prijava link navigates to the sign-in route", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Prijava" }).click();

    await expect(page).toHaveURL(/\/prijava$/);
    await expect(page.locator("h1")).toHaveText("Prijava");
  });

  test("/legacy/ still serves the vanilla prototype", async ({ page }) => {
    const response = await page.goto("/legacy/");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Pisač Prototip");
    // The prototype's root element and its own stylesheet, i.e. the relative
    // asset paths under /legacy/ still resolve.
    await expect(page.locator("div.app")).toHaveCount(1);
    await expect(
      page.locator('link[rel="stylesheet"][href="assets/styles.css"]'),
    ).toHaveCount(1);
  });
});
