import { test, expect, type Page } from "../console-guard";
import { tileAction } from "../launcher-actions.js";
import { openHome, seed } from "./fixture.js";

// Two home screens, the person's choice (#96, owner 2026-10-16): Classic, the default, and Tiles —
// the Start screen. Chosen in Look, kept per device across reloads, and switching never loses either
// one's arrangement: Classic's pins stay Classic's, Start's wall stays Start's.

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await seed(page);
});

const classic = (page: Page) => page.locator(".k-launcher-home .k-launch-grid").first();
const start = (page: Page) => page.locator(".k-launcher-home.k-metro");

async function choose(page: Page, style: RegExp): Promise<void> {
  await page.getByRole("button", { name: "Look — appearance and colour" }).click();
  const look = page.getByRole("dialog", { name: "Look" });
  await look.getByRole("radiogroup", { name: "Home screen" }).getByRole("radio", { name: style }).click();
  await look.getByRole("button", { name: "Close" }).click();
}

test("Classic by default; Tiles chosen in Look sticks across a reload, and so does Classic chosen back", async ({ page }) => {
  await openHome(page);
  await expect(classic(page)).toBeVisible();
  await expect(start(page)).toHaveCount(0);

  await choose(page, /^Tiles/);
  await expect(start(page)).toBeVisible();
  await page.reload();
  await expect(start(page)).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("potyro:look")!).launcher)).toBe("start");

  await choose(page, /^Classic/);
  await expect(classic(page)).toBeVisible();
  await page.reload();
  await expect(classic(page)).toBeVisible({ timeout: 30_000 });
  await expect(start(page)).toHaveCount(0);
  // Classic is the absence of a choice, as Potyro's own accent is.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("potyro:look")!).launcher)).toBeUndefined();
});

test("a wall arranged in Tiles, and pins made in Classic, both survive a round trip through the other", async ({ page }) => {
  await openHome(page);
  // Classic: pin Tasks.
  await tileAction(page, "Tasks", "pin");
  await expect(page.getByRole("region", { name: "Pinned" })).toBeVisible();

  // Tiles: make Trips wide.
  await choose(page, /^Tiles/);
  const trips = page.locator('.k-metro-wall .k-metro-cell[data-key="user:trips"]');
  await expect(trips).toBeVisible({ timeout: 30_000 });
  await trips.locator(".k-metro-tile").focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("radio", { name: /wide/i }).click();
  await expect(trips).toHaveAttribute("data-size", "wide");
  await page.getByRole("button", { name: /^done$/i }).click();

  // Back to Classic, through a reload: Tasks is still pinned there.
  await choose(page, /^Classic/);
  await page.reload();
  await expect(page.getByRole("region", { name: "Pinned" }).locator('[data-key="user:tasks"]')).toBeVisible({ timeout: 30_000 });

  // And Tiles again: Trips is still wide.
  await choose(page, /^Tiles/);
  await page.reload();
  await expect(page.locator('.k-metro-wall .k-metro-cell[data-key="user:trips"]')).toHaveAttribute("data-size", "wide", { timeout: 30_000 });
});

test("the first time Look opens, it suggests Tiles in one line — and never again", async ({ page }) => {
  await openHome(page);
  await page.getByRole("button", { name: "Look — appearance and colour" }).click();
  const look = page.getByRole("dialog", { name: "Look" });
  await expect(look.locator(".k-look-hint")).toContainText("try Tiles");
  // A line in the panel, not a dialog of its own.
  await expect(page.locator("[role=dialog][aria-modal=true]")).toHaveCount(1);
  await look.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Look — appearance and colour" }).click();
  await expect(page.getByRole("dialog", { name: "Look" })).toBeVisible();
  await expect(page.locator(".k-look-hint")).toHaveCount(0);
});
