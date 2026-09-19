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
