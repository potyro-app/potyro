import { test, expect, type Page } from "./console-guard";

// A first visit to a production build (#48; `pnpm test:e2e:prod`): the dev server serves no built
// script and registers no worker, so none of this can be seen there.
//
// 1. The page shows Home's own top (the wordmark, the heading) from its HTML, before its script has
//    arrived, and Home then takes that place without anything moving. The page says it is ready
//    (`data-potyro-ready`, which the Android splash waits for) only once Home is up.
// 2. The Studio, an app's own screen and the sync half of the store are no longer in the page's
//    first script. The worker's install keeps them all the same, so after ONE visit, on a connection
//    the browser says nothing about (nothing big is fetched), the Studio opens offline and so does
//    an app that was opened before.

/** What `navigator.connection` says, before the page runs. */
async function connection(page: Page, info: { type?: string; saveData: boolean }): Promise<void> {
  await page.addInitScript((value) => {
    Object.defineProperty(Navigator.prototype, "connection", { get: () => value, configurable: true });
  }, info);
}

interface BuildList {
  entry: string;
  boot: string[];
  rest: string[];
}

function buildList(page: Page): Promise<BuildList> {
  return page.evaluate(async () => (await (await fetch("/shell-precache.json")).json()) as BuildList);
}

/** How many of these files the worker has not kept. */
function missing(page: Page, files: string[]): Promise<number> {
  return page.evaluate(async (all) => (await Promise.all(all.map((f) => caches.match(f)))).filter((k) => !k).length, files);
}

/** Home as React renders it: never the page's own first screen. */
const HOME = ".k-launcher:not([data-first-screen])";

async function home(page: Page): Promise<void> {
  await expect(page.locator(HOME)).toBeVisible({ timeout: 30_000 });
}

/** Where a part of Home's top is, to the half pixel. */
async function boxOf(page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`nothing at ${selector}`);
  const half = (n: number): number => Math.round(n * 2) / 2;
  return { x: half(box.x), y: half(box.y), width: half(box.width), height: half(box.height) };
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`a first visit, ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 390, height: 844 } });

    test("the page shows the wordmark and the heading before its script runs, and Home takes their place without moving", async ({ page }) => {
      // The page's first script is held back until the first screen has been looked at.
      const { entry } = (await (await page.request.get("/shell-precache.json")).json()) as BuildList;
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route(`**${entry}`, async (route) => {
        await held;
        await route.continue();
      });

      await page.goto("/", { waitUntil: "commit" });
      const first = page.locator("[data-first-screen]");
      await expect(first.locator(".k-wordmark")).toBeVisible();
      await expect(first.locator("h2")).toBeVisible();
      await expect(first.locator("h2")).toHaveText("Make the app you need");
      // Nothing real is up yet: whoever holds a splash over the page keeps holding it.
      expect(await page.evaluate(() => document.documentElement.dataset.potyroReady ?? null)).toBeNull();
      await page.evaluate(() => document.fonts.ready);
      const before = {
        mark: await boxOf(page, "[data-first-screen] .k-wordmark"),
        heading: await boxOf(page, "[data-first-screen] .k-welcome h2"),
        lede: await boxOf(page, "[data-first-screen] .k-welcome p"),
        ink: await first.locator("h2").evaluate((el) => getComputedStyle(el).color),
        ground: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      };

      release();
      await home(page);
      await expect(first).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.potyroReady ?? null)).toBe("1");
      const after = {
        mark: await boxOf(page, `${HOME} .k-launcher-head .k-wordmark`),
        heading: await boxOf(page, `${HOME} .k-welcome h2`),
        lede: await boxOf(page, `${HOME} .k-welcome p`),
        ink: await page.locator(`${HOME} .k-welcome h2`).evaluate((el) => getComputedStyle(el).color),
        ground: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      };
      expect(after).toEqual(before);
      // Its mark on <html>, which held Home's fade-in back, is off again.
      await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-first-screen"))).toBe(false);
    });
  });
}

test("a link that opens an app shows none of Home first", async ({ page }) => {
  const { entry } = (await (await page.request.get("/shell-precache.json")).json()) as BuildList;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${entry}`, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/?user=groceries", { waitUntil: "commit" });
  // The page is there (its root is), and the few lines after it have taken Home's top away.
  await page.locator("#root").waitFor({ state: "attached" });
  await expect(page.locator("[data-first-screen]")).toHaveCount(0);
  release();
  await expect(page.locator(".k-scope")).toContainText("Weekly shop", { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.potyroReady ?? null)).toBe("1");
});

test("after one visit with nothing big fetched, the Studio and an app opened before work offline", async ({ page, context }) => {
  await connection(page, { saveData: false });
  await page.goto("/");
  await home(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 20_000 }).toBe(true);

  // What Home does not load is on the list the worker's install keeps, and is kept.
  const { boot, rest } = await buildList(page);
  for (const kept of [/\/assets\/App-[^/]+\.js$/, /\/assets\/studio-[^/]+\.js$/, /\/assets\/sync-[^/]+\.js$/]) expect(boot.some((f) => kept.test(f)), String(kept)).toBe(true);
  await expect.poll(() => missing(page, boot), { timeout: 60_000 }).toBe(0);
  // And nothing big was fetched to get there: the bundler's Wasm waits to be asked for.
  const wasm = rest.filter((f) => f.endsWith(".wasm"));
  expect(await missing(page, wasm)).toBe(wasm.length);

  // An app opened once, online, the way a person opens it.
  const all = page.getByRole("tab", { name: "All apps" });
  if (await all.isVisible()) await all.click();
  await page.locator(".k-launch-tile", { hasText: "Groceries" }).first().click();
  await expect(page.locator(".k-scope")).toContainText("Weekly shop", { timeout: 30_000 });
  await page.goto("/");
  await home(page);

  await context.setOffline(true);
  await page.reload();
  await home(page);

  // The Studio itself, not the frame shown while it arrives: its own first question is there. (With
  // no network it then says app making cannot be reached, which is true.)
  await page.getByRole("button", { name: "New app" }).first().click();
  const studio = page.getByRole("dialog", { name: "App studio" });
  await expect(studio.getByText("What would you like to make?")).toBeVisible({ timeout: 15_000 });
  await expect(studio).not.toHaveAttribute("aria-busy", "true");
  await studio.getByRole("button", { name: "Close studio" }).click();
  await expect(studio).toHaveCount(0);

  // And the app, whose own screen is a chunk the page never loaded as it booted.
  if (await all.isVisible()) await all.click();
  await page.locator(".k-launch-tile", { hasText: "Groceries" }).first().click();
  await expect(page.locator(".k-scope")).toContainText("Weekly shop", { timeout: 30_000 });
  await context.setOffline(false);
});
