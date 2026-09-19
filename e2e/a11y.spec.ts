import { expect, test } from "@playwright/test";

/**
 * Fixtures: FX-X-A11Y-001 (partial).
 *
 * Lean structural checks on the three routes that render unconfigured. No axe
 * dependency: these are the invariants we are prepared to defend (one h1, the
 * document language, named controls and links, a visible focus ring), not an
 * automated conformance claim. The editor surface is behind the auth guard and
 * is therefore not covered here.
 */
const ROUTES = ["/", "/prijava", "/postavljanje"] as const;

/** Runs in the page: an element's accessible name, by the rules we rely on. */
function accessibleNames(selector: string) {
  return Array.from(document.querySelectorAll(selector)).map((element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    const fromIds = (labelledBy ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    const id = element.getAttribute("id");
    const forLabel = id
      ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
      : null;
    const wrapping = element.closest("label")?.textContent ?? null;
    const name =
      element.getAttribute("aria-label") ??
      (fromIds || null) ??
      forLabel ??
      wrapping ??
      element.textContent ??
      "";
    return { tag: element.tagName.toLowerCase(), name: name.trim() };
  });
}

for (const route of ROUTES) {
  test.describe(`a11y basics on ${route}`, () => {
    test("has exactly one h1 and declares lang=hr", async ({ page }) => {
      await page.goto(route);

      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("html")).toHaveAttribute("lang", "hr");
    });

    test("every form control and link carries an accessible name", async ({
      page,
    }) => {
      await page.goto(route);

      const controls = await page.evaluate(
        accessibleNames,
        "input, select, textarea, button",
      );
      expect(controls.filter((control) => control.name === "")).toEqual([]);

      const links = await page.evaluate(accessibleNames, "a[href]");
      // Every page under test offers at least one navigable link.
      expect(links.length).toBeGreaterThan(0);
      expect(links.filter((link) => link.name === "")).toEqual([]);
    });

    test("the first Tab reaches a link and the focus ring is drawn", async ({
      page,
    }) => {
      await page.goto(route);
      await page.locator("h1").waitFor();
      await page.keyboard.press("Tab");

      const focused = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) {
          return null;
        }
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? "").trim(),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });

      expect(focused).not.toBeNull();
      expect(focused?.tag).toBe("a");
      expect(focused?.text).not.toBe("");
      // Keyboard focus must be perceivable: an outline that is neither
      // `none` nor zero-width.
      expect(focused?.outlineStyle).not.toBe("none");
      expect(focused?.outlineWidth).not.toBe("0px");
    });
  });
}

/**
 * Fixtures: FX-X-A11Y-001 (partial).
 *
 * The mobile-first guard (F1-9b). 360px is the narrowest screen we design for;
 * at that width nothing may push the document wider than the viewport, because
 * a page the author has to scroll sideways to read is a page whose controls
 * they will miss. `scrollWidth` is asserted on `documentElement` rather than
 * inferred from a screenshot, and there is deliberately no `overflow-x:
 * hidden` in the stylesheet — that would clip the symptom and make this test
 * pass on a page that is still broken.
 */
test.describe("mobile viewport, 360px", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  for (const route of ROUTES) {
    test(`${route} does not scroll horizontally`, async ({ page }) => {
      await page.goto(route);
      await page.locator("h1").waitFor();

      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));

      expect(widths.scroll).toBeLessThanOrEqual(360);
      // The page really is being laid out at 360px, so the assertion above is
      // about wrapping rather than about a viewport that never applied.
      expect(widths.client).toBeLessThanOrEqual(360);
    });
  }

  test("the landing heading is readable at 360px", async ({ page }) => {
    await page.goto("/");

    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText("Pisač");

    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(360);
  });
});
