import { test, expect } from "./console-guard";

// The Studio's quick adjustments, the two left from DESIGN.md §10 (#423): an app's own theme —
// light, dark or the system's — chosen beside the colour clock and worn by the phone frame while
// the Studio around it keeps the platform's, and by the whole page once the app is open; and
// Publish becoming Copy link once the app has a published link.

test.use({ viewport: { width: 1440, height: 900 } });

async function openStudio(page: import("@playwright/test").Page) {
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-name")).toHaveText("Groceries", { timeout: 60_000 });
  return studio;
}

test("Dark on the switch: the phone's screen goes dark, the Studio stays light, and the open app follows", async ({ page }) => {
  const studio = await openStudio(page);
  const frame = studio.locator(".k-preview-screen");
  await expect(frame).toBeVisible({ timeout: 60_000 });
  await expect(frame).not.toHaveClass(/k-theme-/);
  const group = studio.getByRole("radiogroup", { name: "Appearance" });
  await group.getByRole("radio", { name: "Dark" }).click();
  await expect(group.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await expect(frame).toHaveClass(/k-theme-dark/);
  // The frame's ground is the dark theme's; the page around it is still the light one.
  expect(await frame.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(28, 27, 28)");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim())).toBe("#ffffff");
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBeNull();

  // Opened on its own, the app brings its theme to the whole page; the launcher takes it away again.
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim())).toBe("#1c1b1c");
  await page.goto("/");
  await expect(page.locator(".k-launcher-home")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);

  // Back to the system's: the frame wears nothing of its own.
  await openStudio(page);
  await page.locator(".k-studio").getByRole("radiogroup", { name: "Appearance" }).getByRole("radio", { name: "System" }).click();
  await expect(page.locator(".k-studio .k-preview-screen")).not.toHaveClass(/k-theme-/);
});

test("once a link is published, Publish becomes Copy link, and copying says so", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const studio = await openStudio(page);
  const publish = studio.getByRole("button", { name: "Publish" });
  await expect(publish).toBeVisible();
  await publish.click();
  const sheet = page.getByRole("dialog", { name: "Share Groceries" });
  await sheet.getByRole("button", { name: "Make the link" }).click();
  // Made: the sheet offers the ways to hand it on.
  await expect(sheet.getByRole("button", { name: "Done" })).toBeVisible({ timeout: 30_000 });
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);

  const bar = studio.locator(".k-studio-publish");
  await expect(bar).toHaveText("Copy link");
  await expect(bar).toHaveAttribute("data-published", "true");
  await bar.click();
  await expect(bar).toHaveText("Copied");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toMatch(/^http/);
  // The sheet is still a step away, in the menu.
  await studio.getByRole("button", { name: "Studio menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Publish" })).toBeVisible();
});
