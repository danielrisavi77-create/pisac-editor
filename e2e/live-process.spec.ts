import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function open(page: import("@playwright/test").Page) {
  await page.goto("/demo");
  const editor = page.locator(".tiptap[contenteditable='true']");
  await expect(editor).toBeVisible();
  const panel = page.getByRole("region", { name: "Stvarni proces pisanja" });
  await expect(panel).toBeVisible();
  return { editor, panel };
}

test.describe("Opt-in live editor process", () => {
  test("records real edits, not seeded activity, and replays the initial document", async ({ page }) => {
    const { editor, panel } = await open(page);
    await editor.fill("Postojeći tekst.");
    await expect(panel).toHaveAttribute("data-capture-status", "idle");
    await expect(panel.getByTestId("capture-count")).toHaveText("0");
    await panel.getByRole("button", { name: "Pokreni lokalno bilježenje" }).click();
    await editor.press("ControlOrMeta+End");
    await editor.pressSequentially(" Čćžšđ.");
    const finalText = await editor.textContent();
    await panel.getByRole("button", { name: "Završi i provjeri sesiju" }).click();
    await expect(panel).toHaveAttribute("data-capture-status", "verified-local");
    await expect(panel.getByTestId("live-replay")).toHaveText(finalText ?? "");
    await panel.getByRole("slider", { name: "Događaj stvarne sesije" }).fill("0");
    await expect(panel.getByTestId("live-replay")).toHaveText("Postojeći tekst.");
    const before = await panel.getByTestId("capture-count").textContent();
    await editor.pressSequentially(" Izvan završene sesije.");
    await expect(panel.getByTestId("capture-count")).toHaveText(before ?? "");
  });

  test("captures paste, delete, formatting, paragraph and history operations", async ({ page }) => {
    const { editor, panel } = await open(page);
    await editor.fill("");
    await panel.getByRole("button", { name: "Pokreni lokalno bilježenje" }).click();
    await editor.pressSequentially("Tekst");
    await editor.evaluate(element => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", " Zalijepljeno.");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    });
    await expect(editor).toContainText("Zalijepljeno.");
    await editor.press("Backspace");
    await editor.press("ControlOrMeta+z");
    await editor.press("ControlOrMeta+Shift+z");
    await editor.press("End");
    await editor.press("Enter");
    await editor.pressSequentially("Drugi odlomak");
    await editor.press("ControlOrMeta+a");
    await page.getByRole("button", { name: "Podebljano", exact: true }).click();
    const text = await editor.textContent();
    await panel.getByRole("button", { name: "Završi i provjeri sesiju" }).click();
    await expect(panel).toHaveAttribute("data-capture-status", "verified-local");
    await expect(panel.getByTestId("live-replay")).toHaveText(text ?? "");
    const downloadPromise = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Preuzmi zapis procesa" }).click();
    const download = await downloadPromise;
    const file = await download.path();
    expect(file).not.toBeNull();
    const data = JSON.parse(await readFile(file!, "utf8"));
    expect(data.format).toBe("pisac-local-transactions-v1");
    expect(data.events.some((entry: { event: { source: string } }) => entry.event.source === "paste")).toBe(true);
    expect(JSON.stringify(data.events)).toContain("addMark");
    expect(data.receipt.eventCount).toBe(data.events.length);
    expect(data.receipt.headHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data).not.toHaveProperty("humanProbability");
    expect(data).not.toHaveProperty("authorshipVerified");
  });

  test("selection changes are not logged and the UI states local-only limits", async ({ page }) => {
    const { editor, panel } = await open(page);
    await editor.fill("Prije uključivanja");
    await panel.getByRole("button", { name: "Pokreni lokalno bilježenje" }).click();
    await editor.press("ArrowLeft");
    await editor.press("ArrowRight");
    await expect(panel.getByTestId("capture-count")).toHaveText("0");
    await expect(panel).toContainText("Zatvaranje ili osvježavanje stranice briše ovaj zapis");
    await expect(panel).toContainText("nije dokaz ljudskog autorstva");
    await panel.getByRole("button", { name: "Završi i provjeri sesiju" }).click();
    await expect(panel).toHaveAttribute("data-capture-status", "verified-local");
  });
});
