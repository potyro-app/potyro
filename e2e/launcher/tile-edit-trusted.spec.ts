import { test, expect } from "../console-guard";
import { tileAction } from "../launcher-actions.js";
import { expectTappable, openApp, openHome, seed } from "./fixture.js";

// Editing a tile (#83), on a phone: what this device calls an app, shows for it and colours it —
// from the tile menu, without a reload, surviving one, and never touching the app's own name.

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test("rename, re-icon and recolour a tile; the tile changes at once, survives a reload, and the app keeps its own name", async ({ page }) => {
  await openHome(page);
  await tileAction(page, "Recipes", "edit-tile");
  const dialog = page.getByRole("dialog", { name: "Edit tile: Recipes" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Tile name" }).fill("Mum's recipes");
  const icon = dialog.getByRole("button", { name: "Icon 🥘" });
  await expectTappable(icon);
  await icon.tap();
  const hue = dialog.getByRole("button", { name: "Hue 205" });
  await expectTappable(hue);
  await hue.tap();
  await dialog.getByRole("button", { name: "Save" }).tap();
  await expect(dialog).toHaveCount(0);

  const tile = page.locator(".k-launch-tile", { hasText: "Mum's recipes" });
  await expect(tile).toBeVisible();
  await expect(tile.locator(".k-launch-avatar")).toHaveText("🥘");
  expect(await tile.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--tile-accent"))).toBe("oklch(72% 0.13 205)");
  await expect(page.locator(".k-launch-tile", { hasText: /^.?Recipes/ })).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".k-launch-tile", { hasText: "Mum's recipes" })).toBeVisible();
  await expect(page.locator(".k-launch-tile", { hasText: "Mum's recipes" }).locator(".k-launch-avatar")).toHaveText("🥘");

  // One rule: the override is the tile's. The app itself still says what it says.
  await openApp(page, "recipes", "Recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes");
});
