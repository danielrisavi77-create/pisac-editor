import { expect, test } from "@playwright/test";

/**
 * Fixtures: FX-X-CLIENT-001 (partial), FX-X-A11Y-001 (partial).
 *
 * `/demo` is the one route where the F1 editor runs end to end without
 * Supabase: no auth guard, no server document, no drain. That makes it the
 * first place the journal and the sync machine can actually be exercised by a
 * browser in this suite — everything equivalent on `/d/[id]` sits behind the
 * auth guard and is recorded as BLOCKED in e2e/EVIDENCE.md.
 *
 * The central assertion is a NEGATIVE one as much as a positive: typing must
 * reach LOCAL_DURABLE, and it must stop there. SYNCED on this route would mean
 * the demo is claiming a server that does not exist.
 */

const SENTENCE = "Ovo je demo rečenica za lokalnu pohranu.";

/** The editor is mounted client-side after the journal has been read. */
async function openDemo(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  await expect(page.locator("h1")).toHaveText("Demo");
  await expect(page.locator(".tiptap[contenteditable='true']")).toBeVisible();
}

test.describe("public demo", () => {
  test("loads without a session and says where the text lives", async ({ page }) => {
    await openDemo(page);

    await expect(page.locator("[data-demo-banner]")).toContainText(
      "Demo bez prijave. Sadržaj se sprema samo u ovaj preglednik.",
    );
    await expect(
      page.locator("[data-demo-banner]").getByRole("link", { name: "Prijava" }),
    ).toHaveAttribute("href", "/prijava");
  });

  test("the landing page offers the demo as its primary action", async ({ page }) => {
    await page.goto("/");

    const cta = page.getByRole("link", { name: "Isprobaj editor (demo)" });
    await expect(cta).toHaveAttribute("href", "/demo");
    await cta.click();
    await expect(page).toHaveURL(/\/demo$/);
  });

  test("typing reaches LOCAL_DURABLE and stops there", async ({ page }) => {
    await openDemo(page);

    const surface = page.locator(".tiptap");
    await surface.click();
    await surface.pressSequentially(SENTENCE, { delay: 10 });

    // 3s covers the 500ms projection debounce plus one IndexedDB write with
    // room to spare; anything slower is a regression, not a slow machine.
    await expect(page.locator("[data-sync-state]")).toHaveAttribute(
      "data-sync-state",
      "LOCAL_DURABLE",
      { timeout: 3_000 },
    );

    // The honest half: local durable state is not canonical server state, and
    // this route has no server that could ever acknowledge anything.
    await expect(page.locator("[data-sync-state='SYNCED']")).toHaveCount(0);
  });

  test("the bold toolbar button toggles its pressed state", async ({ page }) => {
    await openDemo(page);

    const surface = page.locator(".tiptap");
    await surface.click();
    await surface.pressSequentially("Podebljano", { delay: 10 });
    await page.keyboard.press("ControlOrMeta+a");

    const bold = page.getByRole("button", { name: "Podebljano" });
    await expect(bold).toHaveAttribute("aria-pressed", "false");

    await bold.click();
    await expect(bold).toHaveAttribute("aria-pressed", "true");

    await bold.click();
    await expect(bold).toHaveAttribute("aria-pressed", "false");
  });

  test("the DOCX export button is offered", async ({ page }) => {
    await openDemo(page);

    await expect(page.getByRole("button", { name: "Preuzmi DOCX" })).toBeVisible();
  });
});

/**
 * The mobile-first guard (F1-9b), extended to the demo: 360px is the narrowest
 * screen we design for, and a page the visitor has to scroll sideways is a page
 * whose toolbar they will miss. `scrollWidth` is read from the document rather
 * than inferred from a screenshot, and no `overflow-x: hidden` hides it.
 */
test.describe("demo on a 360px viewport", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("does not scroll horizontally, toolbar and editor included", async ({
    page,
  }) => {
    await openDemo(page);

    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));

    expect(widths.scroll).toBeLessThanOrEqual(360);
    // The page really is being laid out at 360px, so the assertion above is
    // about wrapping rather than about a viewport that never applied.
    expect(widths.client).toBeLessThanOrEqual(360);
  });
});
