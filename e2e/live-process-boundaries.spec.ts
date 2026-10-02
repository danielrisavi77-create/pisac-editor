import { expect, test } from "@playwright/test";

async function open(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  const editor = page.locator(".tiptap[contenteditable='true']");
  await expect(editor).toBeVisible();
  const panel = page.getByRole("region", { name: "Stvarni proces pisanja" });
  await expect(panel).toBeVisible();
  return { editor, panel };
}

test("capture excludes other application fields and starts a new interval explicitly", async ({ page }) => {
  const { editor, panel } = await open(page);
  await panel.getByRole("button", { name: "Pokreni lokalno bilježenje" }).click();
  await page.locator(".defense-demo textarea").first().fill("Ovo nije tekst dokumenta.");
  await expect(panel.getByTestId("capture-count")).toHaveText("0");
  await editor.pressSequentially("Stvarni zapis");
  await panel.getByRole("button", { name: "Završi i provjeri sesiju" }).click();
  await expect(panel).toHaveAttribute("data-capture-status", "verified-local");
  await panel.getByRole("button", { name: "Odbaci ovaj zapis i započni novu sesiju" }).click();
  await expect(panel).toHaveAttribute("data-capture-status", "recording");
  await expect(panel.getByTestId("capture-count")).toHaveText("0");
  await panel.getByRole("button", { name: "Završi i provjeri sesiju" }).click();
  await expect(panel).toHaveAttribute("data-capture-status", "verified-local");
  await expect(panel.getByTestId("live-replay")).toHaveText("Stvarni zapis");
});

test("reload retains the separately journalled document but does not invent process history", async ({ page }) => {
  const { editor, panel } = await open(page);
  await panel.getByRole("button", { name: "Pokreni lokalno bilježenje" }).click();
  await editor.pressSequentially("Dokument ostaje, zapis sesije ne.");
  await expect(page.locator("[data-sync-state]")).toHaveAttribute("data-sync-state", "LOCAL_DURABLE");
  await panel.getByRole("button", { name: "Završi i provjeri sesiju" }).click();
  await expect(panel).toHaveAttribute("data-capture-status", "verified-local");
  await page.reload();
  await expect(editor).toContainText("Dokument ostaje, zapis sesije ne.");
  await expect(panel).toHaveAttribute("data-capture-status", "idle");
  await expect(panel.getByTestId("capture-count")).toHaveText("0");
  await expect(panel.getByTestId("live-replay")).toHaveCount(0);
});

test.describe("live capture at 360px", () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test("recording, verification and replay remain usable without horizontal overflow", async ({ page }) => {
    const { editor, panel } = await open(page);
    await panel.getByRole("button", { name: "Pokreni lokalno bilježenje" }).click();
    await editor.pressSequentially("Mobilni unos: čćžšđ.");
    await panel.getByRole("button", { name: "Završi i provjeri sesiju" }).click();
    await expect(panel).toHaveAttribute("data-capture-status", "verified-local");
    await expect(panel.getByTestId("live-replay")).toHaveText("Mobilni unos: čćžšđ.");
    await expect(panel.getByRole("button", { name: "Preuzmi zapis procesa" })).toBeEnabled();
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    expect(widths.client).toBe(360);
  });
});
