import{test,expect}from"@playwright/test";
test.describe("academic revision lifecycle",()=>{
 test("verified activity opens one draft and explicit seal advances the registry revision",async({page})=>{
  await page.goto("/demo");const editor=page.getByRole("textbox",{name:"Tekst rada"});let registry=page.getByRole("region",{name:"Academic Object Registry"});const bind=registry.getByRole("button",{name:"Poveži CLAIM-014 s ovim odlomkom"});await expect(bind).toBeEnabled();await editor.click();await bind.click();await expect(registry.getByTestId("claim-binding")).toContainText("binding v1");
  const panel=page.getByRole("region",{name:"Stvarni proces pisanja"});await panel.getByRole("button",{name:"Pokreni lokalno bilježenje"}).click();await editor.pressSequentially("A");await expect(panel.getByTestId("persisted-count")).toHaveText("1");await expect(page.locator('[data-sync-state="LOCAL_DURABLE"]')).toBeVisible();await panel.getByRole("button",{name:"Završi i provjeri sesiju"}).click();
  const draft=registry.getByLabel("Draft akademske revizije");await expect(draft).toContainText("Draft revizije 5");await draft.getByRole("button",{name:"Zaključi akademsku reviziju"}).click();await expect(registry.getByTestId("sealed-academic-revision")).toContainText("CLAIM-014 rev. 5");await expect(registry.getByTestId("claim-binding")).toContainText("binding v2");await expect(registry.getByLabel("Draft akademske revizije")).toHaveCount(0);
  await page.reload();registry=page.getByRole("region",{name:"Academic Object Registry"});await expect(registry.getByTestId("sealed-academic-revision")).toContainText("CLAIM-014 rev. 5");await expect(registry.getByTestId("claim-binding")).toContainText("binding v2");await expect(registry.getByLabel("Draft akademske revizije")).toHaveCount(0);
 });
});
