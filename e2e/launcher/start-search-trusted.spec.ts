import { test, expect } from "../console-guard";
import { openApp, openHome, seed, useStart } from "./fixture.js";

// The Tiles home screen (the Start style), chosen in Look; Classic is the default (#96).
test.beforeEach(async ({ page }) => {
  await useStart(page);
});

// Launcher search (#85): past a handful of apps a grid is scanned, not read. On a desktop, typing
// with nothing focused starts filtering and Enter opens the first match; inside an app, Ctrl/⌘K
// opens the switcher with its field focused. Nothing found offers to create what was typed. On a
// phone the field is there but does not take focus on load, so no keyboard covers the grid.

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("typing on the home screen filters to the match; Enter opens it", async ({ page }) => {
    const home = await openHome(page);
    // Eight seeded apps plus the bundled examples — a number that moves whenever an example is
    // added, which is why what follows filters rather than counts.
    // Waited for, not counted on the spot: on a first run the home screen is also filling the
    // examples' live tiles (their sample records and photos), and the list can land a moment later.
    await expect.poll(() => home.locator(".k-launch-item").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(12);
    await page.keyboard.type("gro");
    await expect(home.getByRole("searchbox", { name: "Find an app" })).toHaveValue("gro");
    await expect(home.locator(".k-launch-item")).toHaveCount(1);
    await expect(home.locator(".k-launch-tile", { hasText: "Groceries" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("h1").first()).toHaveText("Groceries");
  });

  test("nothing found offers to create it, and the Studio starts from what was typed", async ({ page }) => {
    const home = await openHome(page);
    await page.keyboard.type("bird spotting");
    await expect(home.locator(".k-launch-item")).toHaveCount(0);
    await home.getByRole("button", { name: "Create “bird spotting”" }).click();
    await expect(page.getByRole("dialog", { name: "App studio" }).getByRole("textbox", { name: "Describe the app" })).toHaveValue("bird spotting");
  });

  test("Ctrl+K inside an app opens the switcher focused; typing and Enter switches", async ({ page }) => {
    await openApp(page, "groceries", "Groceries");
    await page.keyboard.press("ControlOrMeta+k");
    const overlay = page.locator(".k-launcher-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole("searchbox", { name: "Find an app" })).toBeFocused();
    await page.keyboard.type("gar");
    await expect(overlay.locator(".k-launch-tile-row:not(.k-launch-tile-extra)")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.locator("h1").first()).toHaveText("Garden");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the field is one tap away, in All apps, and does not take focus by itself", async ({ page }) => {
    const home = await openHome(page);
    await home.getByRole("tab", { name: "All apps" }).tap();
    const field = home.getByRole("searchbox", { name: "Find an app" });
    await expect(field).toBeVisible();
    await expect(field).not.toBeFocused();
    await field.fill("tri");
    await expect(home.locator(".k-launch-item")).toHaveCount(1);
    await expect(home.locator(".k-launch-tile", { hasText: "Trips" })).toBeVisible();
  });
});
