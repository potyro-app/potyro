import { test, expect, type Page } from "./console-guard";

// "Translate into…" (docs/30 §5): an app written in English, opened on a Polish browser, offers its
// translation in its menu. Asked, its words go to the model — only its interface words, numbered —
// and come back as `locales/pl.po` in the app's folder; the code is not touched. The app opens again
// in Polish, its records as they were typed.
//
// OpenRouter is a mocked route — no real model is called, nothing is spent.

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

const APP = `import { defineApp } from "potyro";

export default defineApp({
  id: "spots",
  name: "Spots",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  entities: {
    spot: { label: "Spot", icon: "📍", displayField: "name", fields: { name: { type: "text", required: true, label: "Name" } } },
  },
  pages: [
    {
      id: "all",
      title: "My spots",
      summary: [{ label: "How many", value: (rows, ctx) => ctx.t("{n, plural, one {# spot} other {# spots}}", { n: rows.length }) }],
      view: { type: "list", entity: "spot", display: { primary: "name" }, emptyText: "No spots yet." },
    },
  ],
});
`;

const POLISH: Record<string, string> = {
  Spots: "Miejsca",
  Spot: "Miejsce",
  Name: "Nazwa",
  "My spots": "Moje miejsca",
  "How many": "Ile",
  "No spots yet.": "Jeszcze nie ma miejsc.",
  "{n, plural, one {# spot} other {# spots}}": "{n, plural, one {# miejsce} few {# miejsca} many {# miejsc} other {# miejsca}}",
};

/** The model, answering each numbered message from the dictionary above; what it was sent is kept. */
async function fakeModel(page: Page): Promise<string[][]> {
  const asked: string[][] = [];
  await page.route("**/ai/health", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
  await page.route("**/ai/complete", (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" }));
  await page.route(OPENROUTER, async (route) => {
    const body = route.request().postDataJSON() as { messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }> };
    const user = body.messages.find((m) => m.role === "user")!;
    const text = typeof user.content === "string" ? user.content : user.content.map((p) => p.text ?? "").join("");
    const list = JSON.parse(text) as Array<{ n: string; text: string }>;
    asked.push(list.map((m) => m.text));
    const answer = Object.fromEntries(list.map((m) => [m.n, POLISH[m.text] ?? m.text]));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { cost: 0.0002 } }) });
  });
  return asked;
}

test("an English app on a Polish browser: Translate into, and it opens again in Polish", async ({ browser, consoleGuard }) => {
  consoleGuard.allow(/Failed to load resource: .*404/, "the free AI relay is not deployed in this test: its /ai/health answers 404");
  const context = await browser.newContext({ locale: "pl-PL", viewport: { width: 1280, height: 900 } });
  await context.addInitScript((source) => {
    sessionStorage.setItem("potyro:engine-config", JSON.stringify({ engine: "openrouter", openrouterKey: "sk-or-test-key" }));
    if (localStorage.getItem("potyro:user-apps")) return;
    localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "spots", name: "Spots", source, trusted: true, updatedAt: new Date().toISOString() }]));
  }, APP);
  const page = await context.newPage();
  const asked = await fakeModel(page);

  await page.goto("/?user=spots");
  await expect(page.locator("h1").first()).toHaveText("Spots", { timeout: 30_000 });
  await expect(page.getByText("No spots yet.")).toBeVisible();

  const offer = page.getByRole("button", { name: /Przetłumacz na/ }).or(page.getByRole("menuitem", { name: /Przetłumacz na/ })).first();
  if (!(await offer.isVisible())) await page.getByRole("button", { name: /^(Więcej|More)$/ }).first().click();
  await offer.click();

  // The app opens again, now in Polish: its title, its empty text, its plural.
  await expect(page.getByText("Jeszcze nie ma miejsc.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Moje miejsca").first()).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]).toEqual(expect.arrayContaining(["My spots", "No spots yet.", "{n, plural, one {# spot} other {# spots}}"]));

  // Asked again, there is nothing missing: the menu no longer offers it.
  await expect(page.getByRole("button", { name: /Przetłumacz na/ })).toHaveCount(0);

  // A word fixed by hand, in Files: the catalog is the app's file, and the app reads the fix.
  await page.goto("/?data=spots&files");
  await page.locator(".k-files-row").filter({ hasText: "pl.po" }).getByRole("button", { name: /pl\.po/ }).first().click();
  const viewer = page.getByRole("dialog", { name: "pl.po" });
  await viewer.getByRole("button", { name: /Edytuj|Edit/ }).click();
  const field = viewer.getByRole("textbox");
  await field.fill((await field.inputValue()).replace('msgstr "Moje miejsca"', 'msgstr "Moje ulubione miejsca"'));
  await viewer.getByRole("button", { name: /^(Zapisz|Save)$/ }).click();
  await expect(viewer.getByRole("status")).toBeVisible();
  // A broken line is refused, and nothing is saved.
  await viewer.getByRole("button", { name: /Edytuj|Edit/ }).click();
  await viewer.getByRole("textbox").fill('msgid "My spots"\nmsgstr "Zepsute');
  await viewer.getByRole("button", { name: /^(Zapisz|Save)$/ }).click();
  await expect(viewer.locator(".k-files-error")).toContainText("line 2");
  await page.goto("/?user=spots");
  await expect(page.getByText("Moje ulubione miejsca").first()).toBeVisible({ timeout: 30_000 });
  await context.close();
});
