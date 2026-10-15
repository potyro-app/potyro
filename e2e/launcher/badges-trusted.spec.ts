import { test, expect } from "../console-guard";
import { openTileMenu } from "../launcher-actions.js";

// Attention badges on the launcher (#86, phase 1): the counts an app already shows, kept on its
// launcher entry while it is open, so home can show them without running every app. Reminders are
// stored as due times, so one that falls due after the app was closed still counts. (Unread chat
// through the relay is covered at the end of chat-two-peers-trusted.spec.ts.)

const DAY = 86_400_000;

test("an app's due reminders show on its tile, and more as time passes, without opening it again", async ({ page }) => {
  const t0 = new Date(2026, 8, 10, 9, 0, 0);
  await page.clock.setFixedTime(t0);
  await page.goto("/?app=plants");
  await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });
  // Give the reminder watcher its debounce and first pass.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("potyro:launcher") ?? "{}")["user:plants"]?.signals?.due?.length ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);

  await page.goto("/");
  const tile = page.locator(".k-launch-tile", { hasText: "Plants" });
  const badge = tile.locator(".k-launch-badge");
  await expect(badge).toBeVisible({ timeout: 30_000 });
  const before = Number(await badge.innerText());
  expect(before).toBeGreaterThan(0);
  await expect(tile).toContainText(/\d+ due/);

  // Sixty days on, every plant's next watering has come: the count grows with the app still closed.
  await page.clock.setFixedTime(new Date(t0.getTime() + 60 * DAY));
  await page.reload();
  await expect.poll(async () => Number(await page.locator(".k-launch-tile", { hasText: "Plants" }).locator(".k-launch-badge").innerText()), { timeout: 30_000 }).toBeGreaterThan(before);

  if (process.env.POTYRO_SHOTS) await page.screenshot({ path: `${process.env.POTYRO_SHOTS}/badges-home.png` });
  // The breakdown is in the tile's menu too.
  await openTileMenu(page, "Plants");
  await expect(page.locator(".k-tile-menu-note")).toHaveText(/\d+ due/);
});

test("an app with nothing to report has no badge element at all", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
  await page.goto("/");
  await expect(page.locator(".k-launch-tile", { hasText: "Recipes" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".k-launch-tile", { hasText: "Recipes" }).locator(".k-launch-badge")).toHaveCount(0);
});
