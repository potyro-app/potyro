import { test, expect, type Page } from "@playwright/test";

// The launcher on a phone (#77). Every per-app control used to appear only on hover, at 25px; on a
// touch device they did not exist. Now one always-visible menu button per tile, ≥ 44px, opens a
// menu whose items are ≥ 44px, and Rename / Share / Delete are reachable without a pointer.

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const SOURCE = 'import { defineApp } from "karta";\nexport default defineApp({ id: "groceries", name: "Groceries", version: "1.0.0", schemaVersion: 1, entities: { item: { displayField: "name", fields: { name: { type: "text" } } } }, pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item" } }] });';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((source) => {
    if (localStorage.getItem("karta:user-apps")) return;
    localStorage.setItem("karta:user-apps", JSON.stringify([{ id: "groceries", name: "Groceries", source, updatedAt: new Date(0).toISOString(), trusted: true }]));
  }, SOURCE);
}

const MIN = 44;

test("a tile's actions are reachable by touch, at 44px, with Delete kept apart", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await expect(page.locator(".k-launcher-home")).toBeVisible();

  const menuButton = page.getByRole("button", { name: "Actions for Groceries" });
  await expect(menuButton).toBeVisible();
  const box = (await menuButton.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(MIN);

  await menuButton.tap();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  for (const name of ["Open", "History", "Share", "Rename", "Delete"]) {
    const item = menu.getByRole("menuitem", { name });
    await expect(item).toBeVisible();
    const b = (await item.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(MIN);
  }
  // Delete is not next to Rename: something separates them.
  const rename = (await menu.getByRole("menuitem", { name: "Rename" }).boundingBox())!;
  const del = (await menu.getByRole("menuitem", { name: "Delete" }).boundingBox())!;
  expect(del.y - (rename.y + rename.height)).toBeGreaterThan(8);

  // Rename through the menu, on touch. The prompt is the shell's own dialog, not window.prompt.
  await menu.getByRole("menuitem", { name: "Rename" }).tap();
  const dialog = page.locator(".k-dialog", { hasText: "Rename app" });
  await expect(dialog).toBeVisible();
  await dialog.locator("input").fill("Weekly groceries");
  await dialog.getByRole("button", { name: "OK" }).tap();
  await expect(page.locator(".k-launch-tile", { hasText: "Weekly groceries" })).toBeVisible();
  await expect(menu).toHaveCount(0);
});
