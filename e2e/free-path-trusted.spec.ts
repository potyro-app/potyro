import { test, expect, type Page, type Route } from "./console-guard";
import { makeDemoLink } from "./share-demo";
import { ask, openFromCard, openNewStudio } from "./studio-helpers.js";

// The free path (#121, #455, #118): someone with no key makes an app on Potyro's own engine, through
// the relay's chat route; when this month's free app making is used up, the Studio says so and shows
// what to do instead of a disabled button — a key, or an app from the gallery made your own; and a
// key asked to be remembered is there in a new tab until Forget.
//
// The relay is faked at the browser's edge: its /health says the chat route serves, its chat route
// answers (or refuses) the way packages/ai-relay/src/chat.ts does. Nothing reaches a model.

const app = `import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", label: "Title", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});`;
const MODEL = "deepseek/deepseek-v4-flash-0731";

type Sent = { path: string; authorization?: string; body: Record<string, unknown> };

/** The relay, faked: /health says the chat route serves; the chat route answers with `answer`. */
async function fakeRelay(page: Page, answer: (route: Route) => Promise<void>): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route("**/ai/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, chat: true, model: MODEL }) }));
  await page.route("**/ai/v1/chat/completions", async (route) => {
    const req = route.request();
    sent.push({ path: new URL(req.url()).pathname, authorization: req.headers().authorization, body: req.postDataJSON() as Record<string, unknown> });
    await answer(route);
  });
  await page.route("**/ai/count", async (route) => {
    const req = route.request();
    sent.push({ path: new URL(req.url()).pathname, authorization: req.headers().authorization, body: req.postDataJSON() as Record<string, unknown> });
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  return sent;
}

/** Model settings → Potyro, which is listed because the relay's /health said its chat route serves. */
async function choosePotyro(page: Page, studio: ReturnType<Page["locator"]>): Promise<void> {
  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /^Potyro/ }).check();
  await modal.getByRole("button", { name: "Close model settings" }).click();
}

test("a fresh profile makes an app with no key, on Potyro's free engine", async ({ page }) => {
  const sent = await fakeRelay(page, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-potyro-left-usd": "0.48" },
      body: JSON.stringify({ choices: [{ message: { content: "```ts\n" + app + "\n```" } }], usage: { cost: 0.004 } }),
    }),
  );
  const openRouter: string[] = [];
  page.on("request", (r) => r.url().startsWith("https://openrouter.ai/") && openRouter.push(r.url()));

  const studio = await openNewStudio(page);
  await choosePotyro(page, studio);
  await expect(studio.getByRole("button", { name: "Model settings" })).toHaveText(/Potyro/);
  await ask(studio, "a reading tracker for my books");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });

  // Through the relay's chat route, as this device (a random id), with the model the relay named — no key.
  const chats = sent.filter((s) => s.path === "/ai/v1/chat/completions");
  expect(chats.length).toBeGreaterThan(0);
  for (const c of chats) {
    expect(c.authorization).toMatch(/^Bearer potyro-device:[A-Za-z0-9_-]{8,100}$/);
    expect(c.body.model).toBe(MODEL);
  }
  expect(openRouter).toEqual([]);
  // What is left, in words, on the engine button.
  await expect(studio.getByRole("button", { name: "Model settings" })).toHaveText(/Potyro · plenty left this month/);
});

test("used up: the relay's refusal opens the panel, and Start from an app opens one from the gallery", async ({ page, context, consoleGuard }) => {
  consoleGuard.allow(/Failed to load resource: .*429/, "the faked relay refuses on purpose: this month's free app making is used up");
  // An app to start from, as the gallery's Make it mine button links it.
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  const link = await makeDemoLink(page, "Groceries");
  await context.route("https://potyro.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><title>Potyro gallery</title><a href="${link}&remix=1">Make it mine</a>` }),
  );

  const sent = await fakeRelay(page, (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "x-potyro-left-usd": "0" },
      body: JSON.stringify({ error: { code: "allowance", message: "This month's free AI on this device is used up. To keep going, add your own key in Model settings.", type: "potyro" } }),
    }),
  );
  const studio = await openNewStudio(page);
  await choosePotyro(page, studio);
  await ask(studio, "a reading tracker for my books");

  // The refusal, in words, on the conversation and first on the panel; the composer steps aside.
  const used = "This month's free app making is used up on this device. Add your own key to keep going, or start from an app in the gallery.";
  const panel = studio.getByRole("region", { name: "Keep going with a key" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole("status").first()).toHaveText(used);
  await expect(panel).toContainText("usually a few cents an app");
  await expect(panel.getByRole("link", { name: "OpenRouter" })).toHaveAttribute("href", "https://openrouter.ai/keys");
  // Only the services Model settings has by name; any other server is an endpoint, said in a line.
  await expect(panel.getByRole("link", { name: "OpenAI" })).toHaveCount(0);
  await expect(panel).toContainText("or any OpenAI-compatible server, in Model settings");
  await expect(studio.getByRole("textbox", { name: "Describe the app" })).toBeHidden();
  await expect(studio.getByRole("button", { name: "Model settings" })).toBeHidden();

  // "I'd pay for a plan": a count, the event and nothing else — and a 44px target.
  const plan = panel.getByRole("button", { name: "I'd pay for a plan" });
  expect((await plan.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await plan.click();
  await expect(panel).toContainText("Counted, thanks. Nothing about you was sent.");
  const counts = sent.filter((s) => s.path === "/ai/count");
  expect(counts.map((c) => c.body)).toEqual([{ event: "want-plan" }]);
  expect(counts[0]!.authorization).toBeUndefined();

  // Start from an app: the gallery, in this tab (#487); its Make it mine opens the app as your own copy.
  await panel.getByRole("link", { name: "Start from an app in the gallery" }).click();
  const gallery = page;
  await expect(gallery).toHaveURL(/^https:\/\/potyro\.com\//);
  expect(context.pages()).toHaveLength(1);
  await gallery.getByRole("link", { name: "Make it mine" }).click();
  const card = gallery.getByRole("dialog", { name: "Make it mine" });
  await expect(card.getByRole("heading", { name: "Groceries" })).toBeVisible({ timeout: 30_000 });
});

test("Remember on this device: a key is there in a new tab, until Forget", async ({ page, context }) => {
  const studio = await openNewStudio(page);
  await studio.getByRole("button", { name: "Model settings" }).click();
  let modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  const remember = modal.getByRole("switch", { name: /Remember on this device/ });
  // Off by default, and nothing to remember until there is a key.
  await expect(remember).toHaveAttribute("aria-checked", "false");
  await expect(remember).toBeDisabled();
  await modal.getByLabel("OpenRouter API key").fill("sk-or-remember-me");
  await remember.click();
  await expect(remember).toHaveAttribute("aria-checked", "true");
  // In the vault, never in plain storage.
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain("sk-or-remember-me");

  // A new tab: nothing from this one's session, the key from the vault.
  const second = await context.newPage();
  const studio2 = await openNewStudio(second);
  await studio2.getByRole("button", { name: "Model settings" }).click();
  modal = second.getByRole("dialog", { name: "Model settings" });
  await expect(modal.getByRole("radio", { name: /OpenRouter/ })).toBeChecked();
  await expect(modal.getByLabel("OpenRouter API key")).toHaveValue("sk-or-remember-me");
  await modal.getByRole("button", { name: "Forget" }).click();
  await expect(modal.getByLabel("OpenRouter API key")).toHaveValue("");
  await expect(modal.getByRole("switch", { name: /Remember on this device/ })).toHaveAttribute("aria-checked", "false");

  const third = await context.newPage();
  const studio3 = await openNewStudio(third);
  await studio3.getByRole("button", { name: "Model settings" }).click();
  modal = third.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await expect(modal.getByLabel("OpenRouter API key")).toHaveValue("");
});
