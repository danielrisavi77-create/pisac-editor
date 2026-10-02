import{test,expect}from"@playwright/test";
test.describe("Mentor Command Center live CLAIM projection",()=>{
 test("updates from the same persistent revision coverage and evidence lifecycle without reload",async({page})=>{
  await page.goto("/demo");const editor=page.getByRole("textbox",{name:"Tekst rada"});const registry=page.getByRole("region",{name:"Academic Object Registry"});const command=page.getByRole("region",{name:"Mentor Command Center"});const bind=registry.getByRole("button",{name:"Poveži CLAIM-014 s ovim odlomkom"});await expect(bind).toBeEnabled();await editor.click();await bind.click();await expect(registry.getByLabel("EvidenceBasis CLAIM-014")).toContainText("RECHECK_REQUIRED");
  const live=command.getByTestId("command-live-claim");await expect(live).toContainText("rev. 4");await expect(live).toContainText("NEVER_REVIEWED");await expect(live).toContainText("delta 1");await expect(live).toContainText("student readiness 1");await expect(live).toContainText("čeka mentor");
  await live.getByRole("button",{name:"Mentor pregledaj live rev. 4"}).click();await expect(live).toContainText("CURRENTLY_COVERED");await expect(live).toContainText("delta 0");await expect(live).toContainText("čeka student");
  await registry.getByLabel("EvidenceBasis CLAIM-014").getByRole("button",{name:"Potvrdi provjeru za rev. 4"}).click();await expect(live).toContainText("student readiness 0");await expect(live).toContainText("čeka none");
  const process=page.getByRole("region",{name:"Stvarni proces pisanja"});await process.getByRole("button",{name:"Pokreni lokalno bilježenje"}).click();await editor.pressSequentially("B");await expect(process.getByTestId("persisted-count")).toHaveText("1");await expect(page.locator('[data-sync-state="LOCAL_DURABLE"]')).toBeVisible();await process.getByRole("button",{name:"Završi i provjeri sesiju"}).click();await registry.getByLabel("Draft akademske revizije").getByRole("button",{name:"Zaključi akademsku reviziju"}).click();
  await expect(live).toContainText("rev. 5");await expect(live).toContainText("CHANGED_SINCE_REVIEW");await expect(live).toContainText("delta 1");await expect(live).toContainText("čeka mentor");
  await live.getByRole("button",{name:"Mentor pregledaj live rev. 5"}).click();await expect(live).toContainText("CURRENTLY_COVERED");await expect(live).toContainText("čeka student");
  await registry.getByLabel("EvidenceBasis CLAIM-014").getByRole("button",{name:"Potvrdi provjeru za rev. 5"}).click();await expect(live).toContainText("čeka none");
 });
});
