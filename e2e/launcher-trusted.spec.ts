import { test, expect } from "@playwright/test";

// The launcher: with no app selected, the shell opens a home screen listing apps by provenance —
// trusted built-ins under "Apps", untrusted saved apps under "My Apps". Selecting a tile launches
// that app; inside an app, the "⊞ Apps" button slides the same launcher in to switch.

test("launcher home lists apps and launches a built-in", async ({ page }) => {
  await page.goto("/");

  const launcher = page.locator(".k-launcher-home");
  await expect(launcher).toBeVisible();
  // Trusted examples appear under "Apps".
  await expect(launcher.getByRole("button", { name: /recipes/ })).toBeVisible();
  await expect(launcher.getByRole("button", { name: /plants/ })).toBeVisible();
  // A "New app" tile opens the Studio.
  await expect(launcher.getByRole("button", { name: /New app/ })).toBeVisible();

  // Launch recipes → it loads the running app.
  await launcher.getByRole("button", { name: /recipes/ }).click();
  await expect(page.locator("h1").first()).toHaveText("Recipes");
});

test("in-app ⊞ Apps button slides in the launcher to switch", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes");

  await page.getByRole("button", { name: "Switch app" }).click();
  const overlay = page.locator(".k-launcher-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole("button", { name: /plants/ })).toBeVisible();

  // Switch to plants.
  await overlay.getByRole("button", { name: /plants/ }).click();
  await expect(page.locator("h1").first()).toHaveText("Plants");
});
