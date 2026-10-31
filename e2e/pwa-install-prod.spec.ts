import { test, expect, type Page } from "./console-guard";

// Potyro on a phone's home screen (#123), against a production build (`pnpm test:e2e:prod`): the dev
// server registers no service worker, so none of this is true there.
//
// 1. The browser counts it installable: the manifest has what Chromium (and Lighthouse) ask for, with
//    no installability errors.
// 2. On Wi-Fi, ONE visit online is enough to work with no network at all: Home, an example app, a
//    record added and still there after a reload. On a connection the browser says nothing about
//    (Safari, Firefox, Chrome on a desktop) nothing big is fetched until the person asks for it in
//    You, and the row says "Everything works offline" only once it is true.
// 3. The install row in You: there when the browser offers installing (the event is faked — a headless
//    browser never offers), the two Safari steps on an iPhone, and gone for good after "No thanks".
//    Every answer in it is 44px tall.
//
// The prod project is not part of `pnpm ci:local all`; run it with `pnpm test:e2e:prod`.

const ROW = "Add Potyro to your home screen";
const KEEP = "Keep Potyro ready offline (about 40 MB)";

/** What `navigator.connection` says, before the page runs: Wi-Fi, or nothing about the type. */
async function connection(page: Page, info: { type?: string; saveData: boolean }): Promise<void> {
  await page.addInitScript((value) => {
    Object.defineProperty(Navigator.prototype, "connection", { get: () => value, configurable: true });
  }, info);
}

/** Every file of the build's list, as the page can read it. */
async function buildFiles(page: Page): Promise<{ build: string; files: string[]; rest: string[] }> {
  return page.evaluate(async () => {
    const list = (await (await fetch("/shell-precache.json")).json()) as { build: string; boot: string[]; rest: string[] };
    return { build: list.build, files: [...list.boot, ...list.rest], rest: list.rest };
  });
}

/** How many of these files the worker has not kept. */
function missing(page: Page, files: string[]): Promise<number> {
  return page.evaluate(async (all) => (await Promise.all(all.map((f) => caches.match(f)))).filter((k) => !k).length, files);
}

/** Heights of the row's buttons, rounded down. */
function buttonHeights(row: ReturnType<Page["getByRole"]>): Promise<number[]> {
  return row.locator("button").evaluateAll((buttons) => buttons.map((b) => Math.floor(b.getBoundingClientRect().height)));
}

async function home(page: Page): Promise<void> {
  await expect(page.locator(".k-launcher")).toBeVisible({ timeout: 30_000 });
}

/** Fire what Chromium fires when a site can be installed; `prompt()` records that it was called. */
async function offerInstall(page: Page): Promise<void> {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt?: () => Promise<void>; userChoice?: Promise<unknown> };
    event.prompt = async () => {
      (window as unknown as { __prompted?: number }).__prompted = ((window as unknown as { __prompted?: number }).__prompted ?? 0) + 1;
    };
    event.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
    window.dispatchEvent(event);
  });
}

async function openYou(page: Page) {
  await page.getByRole("button", { name: "You and your devices" }).click();
  const panel = page.getByRole("dialog", { name: "You and your devices" });
  await expect(panel).toBeVisible();
  return panel;
}

test("the browser counts Potyro installable: manifest, icons, a worker that controls the page", async ({ page, context }) => {
  await page.goto("/");
  await home(page);
  await page.evaluate(() => navigator.serviceWorker.ready);

  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: { errorId: string }[] };
  // A Playwright context is incognito-like; that is the browser profile, not the site.
  expect(installabilityErrors.map((e) => e.errorId).filter((id) => id !== "in-incognito")).toEqual([]);

  const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
  expect(manifest).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone", name: "Potyro", short_name: "Potyro" });
  const icons = manifest.icons as { src: string; sizes: string; purpose: string }[];
  expect(icons.some((i) => i.sizes === "192x192")).toBe(true);
  expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
  expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  for (const icon of [...icons.map((i) => i.src), "/apple-touch-icon.png"]) {
    const res = await page.request.get(icon);
    expect(res.status(), icon).toBe(200);
    expect(res.headers()["content-type"], icon).toBe("image/png");
  }

  // iOS reads the page's head, not the manifest.
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Potyro");
});

test("on Wi-Fi, after one visit online, Potyro opens offline, an example app works, and what you add stays", async ({ page, context }) => {
  await connection(page, { type: "wifi", saveData: false });
  await page.goto("/");
  await home(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // `clients.claim()` in the worker's activate: the page is controlled without a second load.
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 20_000 }).toBe(true);
  // On Wi-Fi the page asks the worker to keep the rest of the build (an app needs files Home never
  // fetches); wait for every file in the build's list to be kept rather than for a while.
  const { build, files } = await buildFiles(page);
  expect(files.length).toBeGreaterThan(20);
  await expect.poll(() => missing(page, files), { timeout: 60_000 }).toBe(0);
  // One cache, this build's, named by the id the build stamped into the worker.
  expect(build).toMatch(/^[0-9a-f]{12}$/);
  expect(await page.evaluate(() => caches.keys())).toEqual([`potyro-${build}`]);
  expect(await (await page.request.get("/sw.js")).text()).toContain(`const BUILD = "${build}";`);

  await context.setOffline(true);
  await page.reload();
  await home(page);

  // An example app, opened from Home the way a person opens it: a navigation to `/?user=…`, which
  // offline is answered with the one kept page.
  const all = page.getByRole("tab", { name: "All apps" });
  if (await all.isVisible()) await all.click();
  await page.locator(".k-launch-tile", { hasText: "Groceries" }).first().click();
  await expect(page.locator(".k-scope")).toContainText("Weekly shop", { timeout: 30_000 });

  const input = page.getByRole("textbox", { name: "Add an item" });
  await input.click();
  await input.fill("Offline oranges");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("checkbox", { name: "Offline oranges", exact: true })).toBeVisible();

  // Still there after a reload with no network: it was stored on the device, not waiting to be sent.
  await page.reload();
  await expect(page.locator(".k-scope")).toContainText("Weekly shop", { timeout: 30_000 });
  await expect(page.getByRole("checkbox", { name: "Offline oranges", exact: true })).toBeVisible();
  await context.setOffline(false);
});

test("on a connection the browser says nothing about, the rest waits until the person asks for it", async ({ page }) => {
  await connection(page, { saveData: false });
  await page.goto("/");
  await home(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 20_000 }).toBe(true);
  const { files, rest } = await buildFiles(page);

  await offerInstall(page);
  const panel = await openYou(page);
  const row = panel.getByRole("group", { name: ROW });
  // What it claims is only what is kept.
  await expect(row).toContainText("It opens like an app. Home and the apps you have opened work offline.");
  await expect(row).not.toContainText("Everything works offline");
  // The bundler's Wasm, the biggest file, was never fetched without asking.
  const wasm = rest.filter((f) => f.endsWith(".wasm"));
  expect(wasm.length).toBeGreaterThan(0);
  expect(await missing(page, wasm)).toBe(wasm.length);

  await row.getByRole("button", { name: KEEP }).click();
  await expect(row).toContainText("Everything works offline.", { timeout: 60_000 });
  await expect(row.getByRole("button", { name: KEEP })).toHaveCount(0);
  expect(await missing(page, files)).toBe(0);
});

test("You offers adding to the home screen only when the browser does, and No thanks is for good", async ({ page }) => {
  await page.goto("/");
  await home(page);

  // Nothing offered, nothing shown — and never on Home itself.
  let panel = await openYou(page);
  await expect(panel.getByRole("group", { name: ROW })).toHaveCount(0);
  await panel.getByRole("button", { name: "Close" }).click();

  await offerInstall(page);
  await expect(page.getByRole("group", { name: ROW })).toHaveCount(0);
  panel = await openYou(page);
  const row = panel.getByRole("group", { name: ROW });
  await expect(row).toBeVisible();
  await expect(row).toContainText("It opens like an app.");
  // A thumb's 44px for every answer, 8px apart.
  for (const height of await buttonHeights(row)) expect(height).toBeGreaterThanOrEqual(44);
  expect(await row.locator(".k-identity-install-actions").evaluate((el) => parseFloat(getComputedStyle(el).columnGap))).toBeGreaterThanOrEqual(8);
  await row.getByRole("button", { name: "Add" }).click();
  // The browser's own dialog was asked for; declined (the faked answer), the row is gone.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted?: number }).__prompted ?? 0)).toBe(1);
  await expect(row).toHaveCount(0);

  // Offered again on the next visit: still nothing, the answer was remembered.
  await page.reload();
  await home(page);
  await offerInstall(page);
  panel = await openYou(page);
  await expect(panel.getByRole("group", { name: ROW })).toHaveCount(0);
});

test.describe("Safari on iPhone", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("gets the two steps, and No thanks puts them away for good", async ({ page }) => {
    await page.goto("/");
    await home(page);
    const panel = await openYou(page);
    const row = panel.getByRole("group", { name: ROW });
    await expect(row).toContainText("Tap Share, then “Add to Home Screen”. It opens like an app.");
    // No offline claim: a home-screen web app on iOS keeps its own storage (docs/27 §5.1).
    await expect(row).not.toContainText("offline");
    await expect(row.getByRole("button", { name: "Add" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: KEEP })).toHaveCount(0);
    for (const height of await buttonHeights(row)) expect(height).toBeGreaterThanOrEqual(44);
    await row.getByRole("button", { name: "No thanks" }).click();
    await expect(row).toHaveCount(0);

    await page.reload();
    await home(page);
    const again = await openYou(page);
    await expect(again.getByRole("group", { name: ROW })).toHaveCount(0);
  });
});
