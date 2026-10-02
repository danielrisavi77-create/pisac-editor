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
    await expect(page.locator("[data-demo-banner]")).toContainText("Demo bez prijave. Sadržaj se sprema samo u ovaj preglednik.");
    await expect(page.locator("[data-demo-banner]").getByRole("link", { name: "Prijava" })).toHaveAttribute("href", "/prijava");
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
    await expect(page.locator("[data-sync-state]")).toHaveAttribute("data-sync-state", "LOCAL_DURABLE", { timeout: 3_000 });
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

test.describe("demo on a 360px viewport", () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test("does not scroll horizontally, toolbar and editor included", async ({ page }) => {
    await openDemo(page);
    const widths = await page.evaluate(() => ({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
    expect(widths.scroll).toBeLessThanOrEqual(360);
    expect(widths.client).toBeLessThanOrEqual(360);
  });
});
const V4_TEXT_FOR_PRIVACY_TEST = "Lindblom dokazuje da je racionalno-sveobuhvatni model neprimjenjiv u stvarnom političkom odlučivanju.";

test.describe("local collaboration demo", () => {
  test("keeps private v4 attention hidden from mentor until sharing", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: "Pretvori u doradu" }).click();
    await page.getByRole("button", { name: "Primijeni izmjenu i odgovor" }).click();
    await page.getByRole("button", { name: "Simuliraj dijeljenje v3" }).click();
    await page.getByRole("button", { name: "Prihvati za v3" }).click();
    await page.getByRole("button", { name: "Student", exact: true }).click();
    await page.getByRole("button", { name: "Simuliraj privatnu sadržajnu izmjenu v4" }).click();
    await expect(page.locator("[data-attention-count]")).toHaveAttribute("data-attention-count", "2");
    await page.getByRole("button", { name: "Mentor", exact: true }).click();
    await expect(page.locator("[data-attention-count]")).toHaveAttribute("data-attention-count", "0");
    await expect(page.getByText("Privatna v4 nije otkrivena.")).toBeVisible();
    await expect(page.getByText(V4_TEXT_FOR_PRIVACY_TEST)).toHaveCount(0);
    await page.getByRole("button", { name: "Student", exact: true }).click();
    await page.getByRole("button", { name: "Simuliraj dijeljenje v4 mentoru" }).click();
    await page.getByRole("button", { name: "Mentor", exact: true }).click();
    await expect(page.locator("[data-attention-count]")).toHaveAttribute("data-attention-count", "2");
  });
});

test.describe("Protected Facts Lekta simulation", () => {
  test("reports unsafe changes without claiming a real Lekta call", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: "Problematična simulacija" }).click();
    const report=page.locator('[data-protected-report="unsafe"]');
    await expect(report).toBeVisible();
    await expect(report.getByText(/N-001/)).toBeVisible();
    await expect(report.getByText(/CHANGED/).first()).toBeVisible();
    await expect(page.getByText("Lokalna simulacija Lekta rezultata.")).toBeVisible();
  });
});

test.describe("Mentor Process View", () => {
  test("replays writing process without claiming unperformed verification", async ({ page }) => {
    await openDemo(page);
    const process=page.getByRole("region",{name:"Mentorski proces pisanja"});
    await expect(process).toBeVisible();
    await expect(process.getByText("Demo ledger · integritet nije kriptografski verificiran")).toBeVisible();
    await process.getByRole("button",{name:"Paste",exact:true}).click();
    await expect(process.getByText(/Zalijepljeno 7 znakova/)).toBeVisible();
    await process.getByRole("button",{name:/Zalijepljeno 7 znakova/}).click();
    await expect(process.getByText("Forensic dokaz")).toBeVisible();
    await expect(process.getByText(/paste · fp-4/)).toBeVisible();
  });
  test("replay scrubber reconstructs only events through selected sequence", async ({ page }) => {
    await openDemo(page);
    const process=page.getByRole("region",{name:"Mentorski proces pisanja"});
    await process.getByRole("slider",{name:"Pozicija replaya"}).fill("3");
    await expect(process.getByText("Rez",{exact:true})).toBeVisible();
    await expect(process.getByText("Događaj 3/8")).toBeVisible();
  });
});

test.describe("Mentor playback controls", () => {
  test("manual navigation and speed changes keep replay deterministic", async ({ page }) => {
    await openDemo(page);
    const process=page.getByRole("region",{name:"Mentorski proces pisanja"});
    await process.getByRole("slider",{name:"Pozicija replaya"}).fill("3");
    await process.getByRole("button",{name:"Sljedeći",exact:true}).click();
    await expect(process.getByText("Događaj 4/8")).toBeVisible();
    await process.getByLabel("Brzina reprodukcije").selectOption("4");
    await expect(process.getByRole("button",{name:"Pokreni"})).toBeEnabled();
  });
  test("play is disabled at the terminal event", async ({ page }) => {
    await openDemo(page);
    const process=page.getByRole("region",{name:"Mentorski proces pisanja"});
    await process.getByRole("slider",{name:"Pozicija replaya"}).fill("8");
    await expect(process.getByRole("button",{name:"Pokreni"})).toBeDisabled();
  });
});

test.describe("Mentor Command Center", () => {
  test("explains the mentor queue without misconduct scoring", async ({ page }) => {
    await openDemo(page);
    const center=page.getByRole("region",{name:"Mentor Command Center"});
    await expect(center).toBeVisible();
    await expect(center.getByText(/Daniel Rišavi/)).toBeVisible();
    await center.getByRole("button",{name:/Petra Novak/}).click();
    await expect(center.getByText(/anomalije integriteta\/procesa za tehnički pregled/)).toBeVisible();
    await expect(center.getByText(/sumnjiv/i)).toHaveCount(0);
    await expect(center.locator("[data-risk-score]")).toHaveCount(0);
  });
  test("derives separate mentor, student and no-action work queues", async ({ page }) => {
    await openDemo(page);
    const center=page.getByRole("region",{name:"Mentor Command Center"});
    await center.getByRole("button",{name:/Čeka studenta/}).click();
    await expect(center.getByText(/Ana Horvat/)).toBeVisible();
    await expect(center.getByText(/Daniel Rišavi/)).toHaveCount(0);
    await center.getByRole("button",{name:/Bez otvorene akcije/}).click();
    await expect(center.getByText(/Marko Marić/)).toBeVisible();
  });
});

test.describe("Mentor Review Delta and Coverage", () => {
  test("opens concrete academic changes from Daniel's command-center item", async ({ page }) => {
    await openDemo(page);
    const center=page.getByRole("region",{name:"Mentor Command Center"});
    await center.getByRole("button",{name:/Daniel Rišavi/}).click();
    await center.getByRole("button",{name:"Promjene i coverage"}).click();
    await expect(center.getByText("Promijenjeno od zadnjeg pregleda")).toBeVisible();
    await expect(center.getByText("CLAIM-014 · tvrdnja o povezanosti",{exact:true}).first()).toBeVisible();
    await expect(center.getByText("RESULT-031 · statistički rezultat",{exact:true}).first()).toBeVisible();
    await expect(center.getByText(/Zaključak §6 · nikad pregledano/)).toBeVisible();
  });
});

test.describe("Mentor project operating modules", () => {
  test("opens revisions, argument path and readiness from one project", async ({ page }) => {
    await openDemo(page);
    const center=page.getByRole("region",{name:"Mentor Command Center"});
    await center.getByRole("button",{name:/Daniel Rišavi/}).click();
    await center.getByRole("button",{name:"Dorade"}).click();
    await expect(center.getByText(/2 odgovora studenta čekaju mentorski pregled/)).toBeVisible();
    await center.getByRole("button",{name:"Argumenti"}).click();
    await expect(center.getByText(/ANALYSIS-011 · regresija/)).toBeVisible();
    await expect(center.getByText(/Zaključak §6/).last()).toBeVisible();
    await center.getByRole("button",{name:"Provjere"}).click();
    await expect(center.getByText("Postoje otvoreni blokeri")).toBeVisible();
    await expect(center.getByText(/Potpora tvrdnje zahtijeva novu provjeru/)).toBeVisible();
  });
});

test.describe("Mentor sequential review workflow", () => {
  test("comment stays on the object while reviewed advances and creates coverage", async ({ page }) => {
    await openDemo(page);
    const center=page.getByRole("region",{name:"Mentor Command Center"});
    await center.getByRole("button",{name:/Daniel Rišavi/}).click();
    await center.getByRole("button",{name:"Pokreni pregled"}).click();
    const queue=center.getByRole("region",{name:"Mentor Review Queue"});
    await expect(queue.getByText("Stavka 1/6")).toBeVisible();
    const firstHeading=await queue.locator("h4").textContent();
    await queue.getByLabel("Mentorska bilješka").fill("Provjeri formulaciju.");
    await queue.getByRole("button",{name:"Komentiraj"}).click();
    await expect(queue.getByText("Stavka 1/6")).toBeVisible();
    await expect(queue.locator("h4")).toHaveText(firstHeading??"");
    await expect(queue.getByLabel("Mentorska bilješka")).toHaveValue("");
    await queue.getByRole("button",{name:"Označi pregledano"}).click();
    await expect(queue.getByText("Stavka 2/6")).toBeVisible();
    await expect(queue.getByText(/novi coverage zapisi: 1/)).toBeVisible();
  });
  test("revision request requires an explanatory note", async ({ page }) => {
    await openDemo(page);
    const center=page.getByRole("region",{name:"Mentor Command Center"});
    await center.getByRole("button",{name:/Daniel Rišavi/}).click();
    await center.getByRole("button",{name:"Pokreni pregled"}).click();
    const queue=center.getByRole("region",{name:"Mentor Review Queue"});
    await expect(queue.getByRole("button",{name:"Traži doradu"})).toBeDisabled();
    await queue.getByLabel("Mentorska bilješka").fill("Potrebno je precizirati odnos rezultata i tvrdnje.");
    await expect(queue.getByRole("button",{name:"Traži doradu"})).toBeEnabled();
  });
});

test.describe("Mentor review context bundle", () => {
  test("shows diff, evidence, impact and actual local event references for CLAIM-014", async ({ page }) => {
    await openDemo(page);
    const center=page.getByRole("region",{name:"Mentor Command Center"});
    await center.getByRole("button",{name:/Daniel Rišavi/}).click();
    await center.getByRole("button",{name:"Pokreni pregled"}).click();
    const context=center.getByRole("region",{name:"Kontekst pregleda CLAIM-014"});
    await expect(context.getByText(/Rezultati pokazuju povezanost/)).toBeVisible();
    await expect(context.getByText(/Rezultati dokazuju povezanost/)).toBeVisible();
    await expect(context.getByText(/Demonstracijski izvor EB-014/)).toBeVisible();
    await expect(context.getByText(/Rasprava §5.2/)).toBeVisible();
    await expect(context.getByText(/događaj: claim-014:002/)).toBeVisible();
    await expect(context.getByText(/fp-5, fp-6, fp-7/)).toHaveCount(0);
    await expect(context.getByText(/nisu kriptografski verificirani/)).toBeVisible();
  });
  test("jumps to the shared demo snapshot and replays the exact claim segment", async ({page}) => {
    await openDemo(page);
    const center=page.getByRole("region",{name:"Mentor Command Center"});
    await center.getByRole("button",{name:/Daniel Rišavi/}).click();
    await center.getByRole("button",{name:"Pokreni pregled"}).click();
    const context=center.getByRole("region",{name:"Kontekst pregleda CLAIM-014"});
    await context.getByRole("button",{name:"Prikaži u dokumentu",exact:true}).click();
    const snapshot=context.getByRole("region",{name:"Podijeljeni demonstracijski dokument revizija 4"});
    await expect(snapshot.locator("mark")).toHaveText("Rezultati dokazuju povezanost promatranih varijabli.");
    await expect(snapshot).toBeFocused();
    await context.getByRole("button",{name:"Prikaži nastanak ove tvrdnje"}).click();
    const replay=context.getByRole("region",{name:"Nastanak tvrdnje CLAIM-014"});
    await replay.getByRole("slider",{name:"Korak nastanka"}).fill("1");
    await expect(replay.locator("[data-claim-replay-text]")).toHaveText("Rezultati pokazuju povezanost promatranih varijabli.");
    await replay.getByRole("button",{name:"Sljedeći korak"}).click();
    await expect(replay.locator("[data-claim-replay-text]")).toHaveText("Rezultati dokazuju povezanost promatranih varijabli.");
  });
  test("review refreshes delta and coverage but does not clear evidence blockers", async ({page}) => {
    await openDemo(page);
    const center=page.getByRole("region",{name:"Mentor Command Center"});
    await center.getByRole("button",{name:/Daniel Rišavi/}).click();
    await center.getByRole("button",{name:"Pokreni pregled"}).click();
    await center.getByRole("button",{name:"Označi pregledano"}).click();
    await expect(center.getByRole("button",{name:"Označi pregledano"})).toBeDisabled();
    await center.getByRole("button",{name:"Promjene i coverage"}).click();
    await expect(center.getByText("Preostalo za pregled: 5")).toBeVisible();
    await expect(center.locator("[data-mentor-delta]").getByText(/CLAIM-014/)).toHaveCount(0);
    await expect(center.locator("[data-mentor-coverage]").getByText(/CLAIM-014.*aktualno pregledano/)).toBeVisible();
    await center.getByRole("button",{name:"Provjere"}).click();
    await expect(center.getByText(/Potpora tvrdnje zahtijeva novu provjeru/)).toBeVisible();
    await center.getByRole("button",{name:"← Natrag na studente"}).click();
    await expect(center.getByRole("button",{name:/Daniel Rišavi/})).toContainText("5 × akademski relevantne promjene");
  });
  test("another project's detail does not link to Daniel's process", async ({page}) => {
    await openDemo(page);
    const center=page.getByRole("region",{name:"Mentor Command Center"});
    await center.getByRole("button",{name:/Petra Novak/}).click();
    await expect(center.getByRole("link",{name:/procesa pisanja/i})).toHaveCount(0);
    await expect(center.getByText(/drugi projekt nije korišten kao zamjena/)).toBeVisible();
  });
});
