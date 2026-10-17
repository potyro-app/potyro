import { test, expect, type Page } from "../console-guard";

// Opening and switching apps without reloading the page (#89). Every switch used to be a full page
// load — a white flash, the bundle, storage and identity all started again — and Back left the site.

const h1 = (page: Page) => page.locator("h1").first();
const live = (page: Page) => page.evaluate(() => (globalThis as unknown as { __potyroLiveApps?: number }).__potyroLiveApps ?? 0);

async function switchTo(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Switch app" }).click();
  await page.locator(".k-launcher-overlay .k-launch-tile", { hasText: name }).click();
  await expect(h1(page)).toHaveText(name, { timeout: 30_000 });
}

test.use({ viewport: { width: 1280, height: 800 } });

test("home → Recipes → Plants → home → Recipes loads the page once, and Back walks it", async ({ page }) => {
  let loads = 0;
  // The app's own loads: Firefox also reports the new tab's about:blank, which Chromium does not.
  page.on("load", (p) => void (p.url().startsWith("about:") || (loads += 1)));
  await page.goto("/");
  await expect(page.locator(".k-launch-tile", { hasText: "Recipes" })).toBeVisible({ timeout: 30_000 });

  await page.locator(".k-launch-tile", { hasText: "Recipes" }).click();
  await expect(h1(page)).toHaveText("Recipes", { timeout: 30_000 });
  await expect(page).toHaveURL(/\?user=recipes$/);
  await switchTo(page, "Plants");
  await page.getByRole("button", { name: "Switch app" }).click();
  await page.locator(".k-launcher-overlay").getByRole("button", { name: /Home/ }).click();
  await expect(page.locator(".k-launcher-home")).toBeVisible();
  await page.locator(".k-launch-tile", { hasText: "Recipes" }).click();
  await expect(h1(page)).toHaveText("Recipes", { timeout: 30_000 });

  expect(loads).toBe(1);

  // Back returns through where you were, in place.
  await page.goBack();
  await expect(page.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(h1(page)).toHaveText("Plants", { timeout: 30_000 });
  await page.goForward();
  await expect(page.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });
  expect(loads).toBe(1);
  expect(await live(page)).toBe(0); // home: nothing left open
});

test("switching ten times leaves exactly one app open, and each app still has its own data", async ({ page }) => {
  await page.goto("/?user=recipes");
  await expect(h1(page)).toHaveText("Recipes", { timeout: 30_000 });
  for (let i = 0; i < 5; i++) {
    await switchTo(page, "Plants");
    await switchTo(page, "Recipes");
  }
  await expect.poll(() => live(page)).toBe(1);
  await expect(page.locator(".k-card", { hasText: "Fluffy Pancakes" })).toBeVisible();
  await switchTo(page, "Plants");
  await expect(page.locator(".k-list-row, .k-tl-card, .k-card").filter({ hasText: "Fern" }).first()).toBeVisible({ timeout: 30_000 });
  // A deep link still works exactly as before.
  await page.goto("/?user=recipes");
  await expect(h1(page)).toHaveText("Recipes", { timeout: 30_000 });
});
