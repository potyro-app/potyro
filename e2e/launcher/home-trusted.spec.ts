import { test, expect } from "@playwright/test";
import { openApp, seed } from "./fixture.js";

// The launcher: with no app selected, the shell opens a home screen listing apps by provenance —
// trusted built-ins under "Apps", untrusted saved apps under "My Apps". Selecting a tile launches
// that app; inside an app, the "⊞ Apps" button slides the same launcher in to switch.

test("launcher home lists apps and launches a built-in", async ({ page }) => {
  await page.goto("/");

  const launcher = page.locator(".k-launcher-home");
  await expect(launcher).toBeVisible();
  // Trusted examples appear under "Apps".
  await expect(launcher.getByRole("button", { name: /Recipes/ })).toBeVisible();
  await expect(launcher.getByRole("button", { name: /Plants/ })).toBeVisible();
  // A "New app" tile opens the Studio.
  await expect(launcher.getByRole("button", { name: /New app/ })).toBeVisible();

  // Launch recipes → it loads the running app.
  await launcher.getByRole("button", { name: /Recipes/ }).click();
  await expect(page.locator("h1").first()).toHaveText("Recipes");
});

test("in-app ⊞ Apps button slides in the launcher to switch", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes");

  await page.getByRole("button", { name: "Switch app" }).click();
  const overlay = page.locator(".k-launcher-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole("button", { name: /Plants/ })).toBeVisible();

  // Switch to plants.
  await overlay.getByRole("button", { name: /Plants/ }).click();
  await expect(page.locator("h1").first()).toHaveText("Plants");
});

// The launcher store (#81): an open is counted where every route to an app passes — boot — so a
// deep link and a reload count exactly like a tap on a tile.
test("opening an app by URL records an open, and a reload records another", async ({ page }) => {
  await seed(page);
  const entry = () => page.evaluate(() => (JSON.parse(localStorage.getItem("karta:launcher") ?? "{}") as Record<string, { openCount?: number; lastOpenedAt?: string }>)["user:groceries"]);
  await openApp(page, "groceries", "Groceries");
  const first = await entry();
  expect(first?.openCount).toBe(1);
  expect(first?.lastOpenedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  await page.reload();
  await expect(page.locator("h1").first()).toHaveText("Groceries");
  expect((await entry())?.openCount).toBe(2);
  // A built-in counts the same way, under its own key.
  await page.goto("/?app=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes");
  const recipes = await page.evaluate(() => (JSON.parse(localStorage.getItem("karta:launcher") ?? "{}") as Record<string, { openCount?: number }>)["builtin:recipes"]);
  expect(recipes?.openCount).toBe(1);
});
