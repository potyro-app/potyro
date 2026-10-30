import { test, expect, type Page } from "./console-guard";

// Potyro on a phone's home screen (#123), against a production build (`pnpm test:e2e:prod`): the dev
// server registers no service worker, so none of this is true there.
//
// 1. The browser counts it installable: the manifest has what Chromium (and Lighthouse) ask for, with
//    no installability errors.
// 2. After ONE visit online it works with no network at all: Home, an example app, a record added
//    and still there after a reload — the promise "works offline" in the install row makes.
// 3. The install row in You: there when the browser offers installing (the event is faked — a headless
//    browser never offers), the two Safari steps on an iPhone, and gone for good after "No thanks".
//
// The prod project is not part of `pnpm ci:local all`; run it with `pnpm test:e2e:prod`.

const ROW = "Add Potyro to your home screen";

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

test("after one visit online, Potyro opens offline, an example app works, and what you add stays", async ({ page, context }) => {
  await page.goto("/");
  await home(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // `clients.claim()` in the worker's activate: the page is controlled without a second load.
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 20_000 }).toBe(true);
  // The page asks the worker to keep the rest of the build (an app needs files Home never fetches);
  // wait for every file in the build's list to be kept rather than for a while.
  const listed = await page.evaluate(async () => {
    const list = (await (await fetch("/shell-precache.json")).json()) as { boot: string[]; rest: string[] };
    return [...list.boot, ...list.rest];
  });
  expect(listed.length).toBeGreaterThan(20);
  await expect
    .poll(
      () =>
        page.evaluate(async (files) => {
          const kept = await Promise.all(files.map((f) => caches.match(f)));
          return kept.filter((k) => !k).length;
        }, listed),
      { timeout: 60_000 },
    )
    .toBe(0);

  await context.setOffline(true);
  await page.reload();
  await home(page);

  // An example app, opened from Home the way a person opens it.
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
  await expect(row).toContainText("It opens like an app and works offline.");
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
    await expect(row).toContainText("Tap Share, then “Add to Home Screen”.");
    await expect(row.getByRole("button", { name: "Add" })).toHaveCount(0);
    await row.getByRole("button", { name: "No thanks" }).click();
    await expect(row).toHaveCount(0);

    await page.reload();
    await home(page);
    const again = await openYou(page);
    await expect(again.getByRole("group", { name: ROW })).toHaveCount(0);
  });
});
