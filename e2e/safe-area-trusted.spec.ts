import { test, expect, type Page } from "@playwright/test";

// Nothing you can tap may sit under a phone's status bar (#253, seen on a Pixel 10).
//
// The shell paints edge to edge (`viewport-fit=cover`), so every full screen has to add the top
// inset back itself, and one that forgets puts its Back button under the clock. On Android,
// Capacitor reports the inset as `--safe-area-inset-top` on <html>; this sets it to 48px the same
// way and checks every interactive element on each full screen is below it.

const INSET = 48;

async function underTheStatusBar(page: Page): Promise<string[]> {
  return page.evaluate((inset) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, a[href], input, [role=tab], [role=button]")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (r.bottom <= 0) continue; // scrolled away above
      if (r.top < inset) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" at ${Math.round(r.top)}px`);
    }
    return out;
  }, INSET);
}

async function withInset(page: Page, url: string): Promise<void> {
  await page.addInitScript((inset) => {
    const set = () => document.documentElement.style.setProperty("--safe-area-inset-top", `${inset}px`);
    if (document.documentElement) set();
    document.addEventListener("DOMContentLoaded", set);
  }, INSET);
  await page.goto(url);
}

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

const SCREENS: Array<[string, string, (page: Page) => Promise<void>]> = [
  ["home", "/", async (page) => void (await expect(page.locator(".k-launcher-head")).toBeVisible({ timeout: 30_000 }))],
  ["an app", "/?app=recipes", async (page) => void (await expect(page.locator(".k-topbar")).toBeVisible({ timeout: 30_000 }))],
  ["the Data page", "/?data=recipes", async (page) => void (await expect(page.locator(".k-datapage-bar")).toBeVisible({ timeout: 30_000 }))],
  [
    "the Studio",
    "/",
    async (page) => {
      await page.locator(".k-launch-fab").tap();
      await page.getByRole("menuitem", { name: /Describe a new app/ }).tap();
      await expect(page.getByRole("dialog", { name: "App studio" })).toBeVisible({ timeout: 30_000 });
    },
  ],
  [
    "a record form",
    "/?app=recipes",
    async (page) => {
      await expect(page.locator(".k-topbar")).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: /New Recipe/ }).first().tap();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  ],
];

for (const [name, url, open] of SCREENS) {
  test(`${name}: nothing to tap is under the status bar`, async ({ page }) => {
    await withInset(page, url);
    await open(page);
    await page.waitForTimeout(400); // let an opening sheet finish moving
    expect(await underTheStatusBar(page)).toEqual([]);
  });
}
