import{test,expect}from"@playwright/test";
test.describe("academic object registry",()=>{
 test("persists an explicit node binding and derives only post-binding verified activity",async({page})=>{
  await page.goto("/demo");const editor=page.getByRole("textbox",{name:"Tekst rada"});const registry=page.getByRole("region",{name:"Academic Object Registry"});const bind=registry.getByRole("button",{name:"Poveži CLAIM-014 s ovim odlomkom"});await expect(bind).toBeEnabled();await editor.click();await bind.click();await expect(registry.getByTestId("claim-binding")).toContainText("binding v1");
  const panel=page.getByRole("region",{name:"Stvarni proces pisanja"});await panel.getByRole("button",{name:"Pokreni lokalno bilježenje"}).click();await editor.pressSequentially("A");await expect(panel.getByTestId("persisted-count")).toHaveText("1");await expect(page.locator('[data-sync-state="LOCAL_DURABLE"]')).toBeVisible();await panel.getByRole("button",{name:"Završi i provjeri sesiju"}).click();
  const activity=registry.getByLabel("Verificirana aktivnost CLAIM-014");await expect(activity).toContainText("eventi 1");await expect(activity).toContainText("→ A");
  await page.reload();const restored=page.getByRole("region",{name:"Academic Object Registry"});await expect(restored.getByTestId("claim-binding")).toContainText("binding v1");await expect(restored.getByLabel("Verificirana aktivnost CLAIM-014")).toContainText("eventi 1");
 });
});