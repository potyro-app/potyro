import { test, expect, type Page } from "../console-guard";
import { openHome, seed } from "./fixture.js";

// The launcher from a keyboard (#94, #96), at desktop width: Tab reaches the wall as one stop and
// arrows walk it, Enter opens a tile, the tile menu is a real menu (focus moves into it,
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

test("Tab reaches the wall in a few presses, arrows walk it, and Enter opens the focused tile", async ({ page }) => {
  await openHome(page);
  await expect(page.locator(".k-launch-tile", { hasText: "Groceries" })).toBeVisible({ timeout: 30_000 });
  // The pivot's tab, the first-run welcome's two buttons (#90), then the wall — one stop for all of it (#96).
  const presses = await tabUntil(page, (a) => a.cls.includes("k-launch-tile"));
  expect(presses).toBeLessThanOrEqual(6);
  // One stop: Tab again leaves the wall rather than walking every tile.
  const firstTile = await active(page);
  await page.keyboard.press("Tab");
  expect((await active(page)).cls).not.toContain("k-metro-tile");
  await page.keyboard.press("Shift+Tab");
  expect((await active(page)).text).toBe(firstTile.text);
  // Arrows move between tiles; they never leave the wall.
  await page.keyboard.press("ArrowRight");
  const second = await active(page);
  expect(second.cls).toContain("k-metro-tile");
  expect(second.text).not.toBe(firstTile.text);
  await page.keyboard.press("ArrowLeft");
  expect((await active(page)).text).toBe(firstTile.text);

  // Enter on a tile opens it.
  await page.locator(".k-launch-tile", { hasText: "Groceries" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("h1").first()).toHaveText("Groceries");
});

test("the tile menu is a keyboard menu: focus in, arrows, Escape back out", async ({ page }) => {
  await openHome(page);
  await page.getByRole("tab", { name: "All apps" }).click(); // every app's menu is on its row there (#96)
  const button = page.getByRole("button", { name: "Actions for Groceries" });
  await button.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Actions for Groceries" });
  await expect(menu).toBeVisible();
  // Focus moved into the menu, onto its first item.
  await expect(menu.getByRole("menuitem", { name: "Open" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Unpin" })).toBeFocused(); // it is on Start (#96)
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Edit tile" })).toBeFocused();
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
  await page.getByRole("tab", { name: "All apps" }).click();
  await page.getByRole("button", { name: "Actions for Books" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  // Up past Duplicate to Rename — the two app-level items sit together above Delete.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
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
