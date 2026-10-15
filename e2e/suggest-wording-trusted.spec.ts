import { test, expect, type Page } from "./console-guard";
import { seed } from "./launcher/fixture.js";

// "Something reads wrong? Suggest a better wording" (#300), in Polish, as rendered. From the
// launcher: You → Language offers Potyro's words from the screen behind the panel, the person picks
// one and writes theirs, and only Send sends. The relay is not deployed (docs/16), so it is saved on
// the device; once the relay answers, opening You again sends it — as a `translation` request.

test.use({ locale: "pl-PL" });

const OUTBOX = "potyro:platform-requests:outbox";
const outbox = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]") as Array<{ payload: Record<string, string> }>, OUTBOX);

test("a better wording for words on the screen is kept, then sent once the team can be reached", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/^Failed to load resource: the server responded with a status of 404/, "the team's endpoint answers 404 on purpose until it can be reached");
  const posted: string[] = [];
  // No relay yet: what the dev server answers for /requests/ is not the relay's JSON.
  await page.route("**/requests/platform-requests", async (route) => {
    posted.push(route.request().postData() ?? "");
    await route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><p>not here</p>" });
  });
  await seed(page);
  await page.goto("/");
  await expect(page.locator(".k-launcher-home").getByRole("searchbox")).toHaveAttribute("placeholder", "Znajdź aplikację");

  await page.locator(".k-launch-you").first().click();
  const panel = page.locator(".k-identity");
  await panel.getByRole("button", { name: "Coś brzmi źle? Zaproponuj lepsze sformułowanie" }).click();
  const form = panel.getByRole("group", { name: "Zaproponuj lepsze sformułowanie" });
  await expect(form.getByText("Na tym ekranie:")).toBeVisible();
  // The launcher's search box, behind the panel, is one of Potyro's own messages.
  await form.getByRole("button", { name: "Znajdź aplikację", exact: true }).click();
  await expect(form.locator(".k-wording-now")).toHaveText("Znajdź aplikację");
  await expect(form.getByText("Po angielsku: Find an app")).toBeVisible();
  expect(posted).toEqual([]); // nothing goes before Send

  await form.getByRole("textbox", { name: "Jak powinno brzmieć?" }).fill("Szukaj aplikacji");
  await form.getByRole("button", { name: "Wyślij" }).click();
  await expect(form.getByRole("status")).toContainText("Zapisano to na tym urządzeniu");
  expect(posted).toHaveLength(1);
  const saved = await outbox(page);
  expect(saved).toHaveLength(1);
  expect(saved[0]!.payload).toMatchObject({ kind: "translation", language: "pl", title: "Wording (pl): “Znajdź aplikację”" });
  expect(saved[0]!.payload.body).toContain("Suggested: Szukaj aplikacji");
  expect(saved[0]!.payload.body).toContain("English: Find an app");

  // The relay is up now: the next time You opens, the saved one goes, once.
  await page.unroute("**/requests/platform-requests");
  const filed: string[] = [];
  await page.route("**/requests/platform-requests", async (route) => {
    filed.push(route.request().postData() ?? "");
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, grouped: false, issue: 1, url: "https://github.com/fuzue/potyro/issues/1" }) });
  });
  await page.reload();
  await page.locator(".k-launch-you").first().click();
  await expect.poll(async () => (await outbox(page)).length).toBe(0);
  expect(filed).toHaveLength(1);
  expect(JSON.parse(filed[0]!)).toMatchObject({ kind: "translation", id: saved[0]!.payload.id });
});

test("finds Potyro's words by what they say, and an app's own words are not among them", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await page.locator(".k-launch-you").first().click();
  const panel = page.locator(".k-identity");
  await panel.getByRole("button", { name: /Zaproponuj lepsze sformułowanie/ }).click();
  const form = panel.getByRole("group", { name: "Zaproponuj lepsze sformułowanie" });
  // By its English, too: someone who knows what it said in English can find it.
  await form.getByRole("searchbox").fill("can't be undone");
  await expect(form.getByRole("button", { name: "Tego nie da się cofnąć." })).toBeVisible();
  await form.getByRole("searchbox").fill("Groceries");
  await expect(form.getByText("Żadne słowa Potyro do tego nie pasują.")).toBeVisible();
});
