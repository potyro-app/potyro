import { test, expect } from "@playwright/test";
import { openApp, openHome, seed } from "./fixture.js";

// The launcher: with no app selected, the shell opens a home screen listing apps by provenance —
// trusted built-ins under "Apps", untrusted saved apps under "My Apps". Selecting a tile launches
// that app; inside an app, the "⊞ Apps" button slides the same launcher in to switch.

test("launcher home lists apps and launches a built-in", async ({ page }) => {
  await page.goto("/");

  const launcher = page.locator(".k-launcher-home");
  await expect(launcher).toBeVisible();
  // Trusted examples appear under "Apps".
  await expect(launcher.locator(".k-launch-tile", { hasText: "Recipes" })).toBeVisible();
  await expect(launcher.locator(".k-launch-tile", { hasText: "Plants" })).toBeVisible();
  // One "New app" action, and it is not a tile among the apps (#90).
  await expect(launcher.getByRole("button", { name: /New app/ }).filter({ visible: true })).toHaveCount(1);
  await expect(launcher.locator(".k-launch-tile", { hasText: "New app" })).toHaveCount(0);

  // Launch recipes → it loads the running app.
  await launcher.locator(".k-launch-tile", { hasText: "Recipes" }).click();
  await expect(page.locator("h1").first()).toHaveText("Recipes");
});

test("in-app ⊞ Apps button slides in the launcher to switch", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes");

  await page.getByRole("button", { name: "Switch app" }).click();
  const overlay = page.locator(".k-launcher-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay.locator(".k-launch-tile", { hasText: "Plants" })).toBeVisible();

  // Switch to plants.
  await overlay.locator(".k-launch-tile", { hasText: "Plants" }).click();
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
  const recipes = await page.evaluate(() => (JSON.parse(localStorage.getItem("karta:launcher") ?? "{}") as Record<string, { openCount?: number }>)["user:recipes"]);
  expect(recipes?.openCount).toBe(1);
});

// Tiles say what matters (#87): nothing on a trusted local app, a shield on a sandboxed one, a sync
// mark on a synced one — never the word TRUSTED on every tile.
test("tiles carry a sandbox shield and a sync mark, and no provenance pill", async ({ page }) => {
  await seed(page);
  const home = await openHome(page);
  await expect(home.locator(".k-prov")).toHaveCount(0);
  const tile = (name: string) => home.locator(".k-launch-tile", { hasText: name });
  // Garden: trusted and synced → a sync mark, no shield.
  await expect(tile("Garden").getByLabel("Synced to your other devices")).toBeVisible();
  await expect(tile("Garden").getByRole("img", { name: "Runs in a sandbox" })).toHaveCount(0);
  // Budget: sandboxed and synced → both marks.
  await expect(tile("Budget").getByRole("img", { name: "Runs in a sandbox" })).toBeVisible();
  await expect(tile("Budget").getByLabel("Synced to your other devices")).toBeVisible();
  // Groceries: trusted and local → nothing at all.
  await expect(tile("Groceries").locator(".k-launch-mark, .k-launch-shield")).toHaveCount(0);
});
