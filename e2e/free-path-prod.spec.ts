import { test, expect, type Page } from "./console-guard";

// The free path on a DEPLOYED build (#121, #455): no `claude -p` here, so what a first visit starts on
// is the build's own choice. With the relay's chat route serving, it is Potyro's free engine and an
// app is made with nothing set up; without it, the Studio says what a key is and where to get one
// instead of a disabled button. The relay is faked at the browser's edge (`pnpm test:e2e:prod`).

const app = `import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", label: "Title", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});`;

// The build's service worker would make the shell's requests itself, past the page's routes: the
// relay is faked at the page, so the worker is kept out.
test.use({ serviceWorkers: "block" });

async function openStudio(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /New app/ }).first().click();
  return page.locator(".k-studio");
}

test("a first visit starts on Potyro's free engine and makes an app with nothing set up", async ({ page }) => {
  await page.route("**/ai/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, chat: true, model: "deepseek/deepseek-v4-flash-0731" }) }));
  const auth: string[] = [];
  await page.route("**/ai/v1/chat/completions", (route) => {
    auth.push(route.request().headers().authorization ?? "");
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "x-potyro-left-usd": "0.5" }, body: JSON.stringify({ choices: [{ message: { content: "```ts\n" + app + "\n```" } }] }) });
  });
  const studio = await openStudio(page);
  // Nothing chosen: the engine is Potyro's own.
  await expect(studio.getByRole("button", { name: "Model settings" })).toHaveText(/^\s*Potyro\s*$/, { timeout: 30_000 });
  await studio.getByRole("textbox", { name: "Describe the app" }).fill("a reading tracker for my books");
  await studio.getByRole("button", { name: "Create the app" }).click();
  await expect(studio.locator(".k-card[data-current]")).toBeVisible({ timeout: 60_000 });
  expect(auth.length).toBeGreaterThan(0);
  expect(auth.every((a) => /^Bearer potyro-device:/.test(a))).toBe(true);
  await expect(studio.getByRole("button", { name: "Model settings" })).toHaveText(/Potyro · plenty left this month/);
});

test("with no free app making and no key, a first visit sees what a key is and where to get one", async ({ page }) => {
  await page.route("**/ai/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, chat: false }) }));
  const studio = await openStudio(page);
  const panel = studio.getByRole("region", { name: "Add a key to make apps" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText("usually a few cents an app");
  await expect(panel.getByRole("link", { name: "Start from an app in the gallery" })).toHaveAttribute("href", "https://potyro.com/");
  await expect(studio.getByRole("textbox", { name: "Describe the app" })).toBeHidden();
  // A key in Model settings, and the composer is back.
  await panel.getByRole("button", { name: "Add a key" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await expect(modal.getByRole("radio", { name: /^Potyro/ })).toHaveCount(0);
  await modal.getByLabel("OpenRouter API key").fill("sk-or-mine");
  await modal.getByRole("button", { name: "Close model settings" }).click();
  await expect(studio.getByRole("textbox", { name: "Describe the app" })).toBeVisible();
});

test("while /health has not answered, the Studio shows neither the key panel nor 'needs an API key'", async ({ page }) => {
  // Slower than a page load, under the shell's three-second look.
  await page.route("**/ai/health", async (route) => {
    await new Promise((r) => setTimeout(r, 2_500));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, chat: true }) });
  });
  // Whether either ever showed, even for a moment, before the answer came.
  await page.addInitScript(() => {
    const w = window as unknown as { __shown?: string[] };
    w.__shown = [];
    new MutationObserver(() => {
      for (const sel of [".k-free-panel", ".k-composer-warn"]) if (document.querySelector(sel) && !w.__shown!.includes(sel)) w.__shown!.push(sel);
    }).observe(document, { childList: true, subtree: true });
  });
  const studio = await openStudio(page);
  await expect(studio.getByRole("button", { name: "Model settings" })).toHaveText(/^\s*Potyro\s*$/, { timeout: 30_000 });
  await expect(studio.getByRole("textbox", { name: "Describe the app" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __shown: string[] }).__shown)).toEqual([]);
});

test("no answer from /health says it can't be reached, and asks again when Model settings opens", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/Failed to load resource/, "the faked relay's /health fails on purpose, as a dropped network does");
  let up = false;
  await page.route("**/ai/health", (route) =>
    up ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, chat: true }) }) : route.abort("failed"),
  );
  const studio = await openStudio(page);
  const panel = studio.getByRole("region", { name: "Add a key to make apps" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole("status")).toHaveText("Free app making can't be reached right now. Check your connection and try again, or add your own key.");
  // The network is back, and Model settings, opened, asks again: Potyro is listed.
  up = true;
  await panel.getByRole("button", { name: "Add a key" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await expect(modal.getByRole("radio", { name: /^Potyro/ })).toBeVisible({ timeout: 30_000 });
  await modal.getByRole("button", { name: "Close model settings" }).click();
  await expect(studio.getByRole("button", { name: "Model settings" })).toHaveText(/^\s*Potyro\s*$/, { timeout: 30_000 });
});

test("Ask, opened in an app before the Studio ever is, starts on Potyro and says where the request goes", async ({ page }) => {
  const source = `import { defineApp } from "potyro";\nexport default defineApp({ id: "reader", name: "Reader", version: "1.0.0", schemaVersion: 1, entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } }, pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }] });`;
  await page.addInitScript((src) => {
    if (!localStorage.getItem("potyro:user-apps")) localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "reader", name: "Reader", source: src, trusted: true, updatedAt: new Date().toISOString() }]));
  }, source);
  await page.route("**/ai/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, chat: true }) }));
  await page.goto("/?user=reader");
  await expect(page.locator("h1").first()).toHaveText("Reader", { timeout: 30_000 });
  await page.getByRole("button", { name: /^✧?\s*Ask\b/ }).click();
  const dialog = page.getByRole("dialog", { name: "Ask Reader" });
  await expect(dialog.getByText(/Potyro passes all of this to OpenRouter and the model it picks\./)).toBeVisible();
  await expect(dialog.getByText(/Ask needs your OpenRouter key/)).toHaveCount(0);
});
