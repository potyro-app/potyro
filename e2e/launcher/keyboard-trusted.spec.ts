import { test, expect, type Page } from "@playwright/test";
import { openHome, seed } from "./fixture.js";

// The launcher from a keyboard (#94), at desktop width: Tab reaches every tile and every menu
// button in reading order, Enter opens a tile, the tile menu is a real menu (focus moves into it,
// arrows walk it, Escape returns focus to the button that opened it).

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await seed(page);
});

const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { tag: el?.tagName, cls: el?.className ?? "", label: el?.getAttribute("aria-label") ?? "", text: el?.textContent?.trim() ?? "" };
  });

/** Press Tab until the focused element matches, or give up after `max` presses. */
async function tabUntil(page: Page, match: (a: Awaited<ReturnType<typeof active>>) => boolean, max = 40): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press("Tab");
    if (match(await active(page))) return i;
  }
  throw new Error(`nothing matched within ${max} Tab presses`);
}

test("Tab walks the grid in order and Enter opens the focused tile", async ({ page }) => {
  await openHome(page);
  // The first tile is a handful of Tabs from the top, not buried.
  const presses = await tabUntil(page, (a) => a.cls.includes("k-launch-tile"));
  expect(presses).toBeLessThanOrEqual(4);

  // Walk on: the built-ins first, then each saved app as tile, then its menu button — reading order.
  const order: string[] = [];
  for (let i = 0; i < 24; i++) {
    const a = await active(page);
    order.push(a.label || a.text);
    await page.keyboard.press("Tab");
  }
  const trail = order.join(" | ");
  // Every menu button comes right after the tile it belongs to, never before, never elsewhere.
  const menus = order.map((o, i) => [o, i] as const).filter(([o]) => o.startsWith("Actions for "));
  expect(menus.length, trail).toBe(8);
  for (const [label, i] of menus) expect(order[i - 1], trail).toContain(label.slice("Actions for ".length));
  // The New app tile closes the grid, after the last saved app's menu button.
  const last = menus[menus.length - 1]![1];
  expect(order[last + 1], trail).toContain("New app");

  // Enter on a tile opens it.
  await page.locator(".k-launch-tile", { hasText: "Groceries" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("h1").first()).toHaveText("Groceries");
});

test("the tile menu is a keyboard menu: focus in, arrows, Escape back out", async ({ page }) => {
  await openHome(page);
  const button = page.getByRole("button", { name: "Actions for Groceries" });
  await button.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Actions for Groceries" });
  await expect(menu).toBeVisible();
  // Focus moved into the menu, onto its first item.
  await expect(menu.getByRole("menuitem", { name: "Open" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "History" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("ArrowDown"); // wraps
  await expect(menu.getByRole("menuitem", { name: "Open" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
  // Escape closes it and puts focus back where it came from.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("Enter on a menu item acts: Rename opens the dialog with the name selected for typing", async ({ page }) => {
  await openHome(page);
  await page.getByRole("button", { name: "Actions for Books" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp"); // Rename sits just above Delete
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.locator(".k-dialog", { hasText: "Rename app" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("input")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Bookshelf");
  await page.keyboard.press("Enter");
  await expect(page.locator(".k-launch-tile", { hasText: "Bookshelf" })).toBeVisible();
});
