import { test, expect } from "@playwright/test";

// KA-04 data round-trip in a real browser: export the recipes data to a .karta.zip, add a recipe
// that ISN'T in that bundle, then import the bundle back — the imported (bundle) data replaces the
// live data, so the seed recipe returns and the just-added one is gone. Forces the <a download> /
// <input> fallbacks so headless Chromium can capture the download + file chooser.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  });
});

test("export → import round-trips app data (trusted)", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1")).toHaveText("Recipes");
  await expect(page.locator(".k-list-row", { hasText: "Fluffy Pancakes" })).toBeVisible();

  // Export the current (seed) data to a bundle file.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("header").getByRole("button", { name: "Export" }).click(),
  ]);
  const bundlePath = await download.path();

  // Add a recipe that is NOT in the exported bundle.
  await page.locator("header").getByRole("button", { name: /New/ }).click();
  const modal = page.locator(".k-modal");
  await modal.getByRole("textbox").first().fill("Ephemeral Dish");
  await modal.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".k-list-row", { hasText: "Ephemeral Dish" })).toBeVisible();

  // Import the earlier bundle → replaces the live data (reloads the app).
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("header").getByRole("button", { name: "Import" }).click(),
  ]);
  await chooser.setFiles(bundlePath);

  await page.waitForURL(/app=recipes/);
  await expect(page.locator(".k-list-row", { hasText: "Fluffy Pancakes" })).toBeVisible(); // bundle data restored
  await expect(page.locator(".k-list-row", { hasText: "Ephemeral Dish" })).toHaveCount(0); // not in the bundle
});
