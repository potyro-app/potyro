import { test, expect } from "./console-guard";

// KA-04 data round-trip in a real browser: export the recipes data to a .potyro.zip, add a recipe
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
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  const bundlePath = await download.path();

  // Add a recipe that is NOT in the exported bundle.
  await page.locator(".k-quickbar").getByRole("button", { name: /Add: Recipe/ }).click();
  const modal = page.locator(".k-modal");
  await modal.getByRole("textbox").first().fill("Ephemeral Dish");
  await modal.getByRole("button", { name: "Create" }).click();
  await page.getByRole("button", { name: /Recipes/ }).click(); // create-and-open → back to the list
  await expect(page.locator(".k-list-row", { hasText: "Ephemeral Dish" })).toBeVisible();

  // Import the earlier bundle → replaces the live data (reloads the app).
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Import" }).click(),
  ]);
  await chooser.setFiles(bundlePath);

  // The import navigates to `?user=recipes` (main.tsx importApp). Waiting for `app=recipes` matched
  // the page we were ALREADY on, so the checks below could run before the import's reload — the
  // "passes alone, fails under load" flake in #74. Wait for the URL the import produces, and the load.
  await page.waitForURL(/\?user=recipes/, { waitUntil: "load" });
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
  // It says it worked — and the page is the app, not a boot error that also has no "Ephemeral Dish".
  await expect(page.locator(".k-toast")).toContainText("Imported data into Recipes");
  await expect(page.locator(".k-list-row", { hasText: "Fluffy Pancakes" })).toBeVisible(); // bundle data restored
  await expect(page.locator(".k-list-row", { hasText: "Ephemeral Dish" })).toHaveCount(0); // not in the bundle
});
