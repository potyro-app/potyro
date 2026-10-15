import { test, expect } from "../console-guard";
import { tileAction } from "../launcher-actions.js";
import { SEED, expectTappable, openApp, openHome, openSwitcher, seed } from "./fixture.js";

// The launcher on a phone (#94): every journey a person does with a thumb, on a 375×812 touch
// device, with every control they tap measured against 44px. This is the harness that would have
// caught #77 — the per-app actions were hover-only, so on a phone they did not exist.

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test("open an app from home, then switch to another from inside it", async ({ page }) => {
  const home = await openHome(page);
  const tile = home.locator(".k-launch-tile", { hasText: "Groceries" });
  await expectTappable(tile);
  await tile.tap();
  await expect(page.locator("h1").first()).toHaveText("Groceries");

  const switcher = page.getByRole("button", { name: "Switch app" });
  await expectTappable(switcher);
  await switcher.tap();
  const overlay = page.locator(".k-launcher-overlay");
  await expect(overlay).toBeVisible();
  // Every seeded app is there, by name — three of them start with G.
  for (const a of SEED) await expect(overlay.locator(".k-launch-tile", { hasText: a.name })).toBeVisible();
  const trips = overlay.locator(".k-launch-tile", { hasText: "Trips" });
  await expectTappable(trips);
  await trips.tap();
  await expect(page.locator("h1").first()).toHaveText("Trips");
});

test("a tile's actions are reachable by touch, at 44px, with Delete kept apart", async ({ page }) => {
  await openHome(page);
  // Every app's menu is on its row in All apps (#96): one tap on the pivot, then the 44px button.
  const tab = page.getByRole("tab", { name: "All apps" });
  await expectTappable(tab);
  await tab.tap();
  const menuButton = page.getByRole("button", { name: "Actions for Groceries" });
  await expect(menuButton).toBeVisible();
  await expectTappable(menuButton);

  await menuButton.tap();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  for (const name of ["Open", "History", "Share", "Rename", "Delete"]) {
    const item = menu.getByRole("menuitem", { name });
    await expect(item).toBeVisible();
    const b = (await item.boundingBox())!;
    expect(Math.round(b.height), `${name} is ${b.height}px tall`).toBeGreaterThanOrEqual(44);
  }
  // Delete is not next to Rename: something separates them.
  const rename = (await menu.getByRole("menuitem", { name: "Rename" }).boundingBox())!;
  const del = (await menu.getByRole("menuitem", { name: "Delete" }).boundingBox())!;
  expect(del.y - (rename.y + rename.height)).toBeGreaterThan(8);
  // Tapping the scrim dismisses it.
  await page.locator(".k-tile-menu-scrim").tap({ position: { x: 10, y: 10 } });
  await expect(menu).toHaveCount(0);
});

test("rename through the menu, on touch, through the shell's own dialog", async ({ page }) => {
  await openHome(page);
  await tileAction(page, "Books", "rename");
  const dialog = page.locator(".k-dialog", { hasText: "Rename app" });
  await expect(dialog).toBeVisible();
  await dialog.locator("input").fill("Bookshelf");
  const ok = dialog.getByRole("button", { name: "OK" });
  await expectTappable(ok);
  await ok.tap();
  await expect(page.locator(".k-launch-tile", { hasText: "Bookshelf" })).toBeVisible();
  await expect(page.locator(".k-launch-tile", { hasText: /^B?Books$/ })).toHaveCount(0);
  // The rename is persisted, not just painted: it survives a reload (the seed is once-only).
  await page.reload();
  await expect(page.locator(".k-launch-tile", { hasText: "Bookshelf" })).toBeVisible();
});

test("delete asks first, in-app, and the tile is gone", async ({ page }) => {
  await openHome(page);
  await tileAction(page, "Trips", "delete");
  const dialog = page.locator(".k-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/can't be undone|cannot be undone/);
  // The way out is as big as the way in.
  await expectTappable(dialog.getByRole("button", { name: "Cancel" }));
  const confirm = dialog.getByRole("button", { name: "Delete" });
  await expectTappable(confirm);
  await confirm.tap();
  await expect(page.locator(".k-launch-tile", { hasText: "Trips" })).toHaveCount(0);
  await expect(page.locator(".k-launch-tile", { hasText: "Tasks" })).toBeVisible(); // its neighbour is not
});

test("share via the tile menu: sync on, a name, then the link with a Copy button", async ({ page }) => {
  await openHome(page);
  await tileAction(page, "Groceries", "share");
  // A local app: sharing turns sync on, and says so first.
  const confirm = page.locator(".k-dialog").getByRole("button", { name: "Confirm" });
  await expectTappable(confirm);
  await confirm.tap();
  const nameDialog = page.locator(".k-dialog", { hasText: "see you as" });
  const shareDialog = page.locator(".k-share-dialog");
  await expect(nameDialog.or(shareDialog).first()).toBeVisible({ timeout: 60_000 });
  if (await nameDialog.count()) {
    await nameDialog.locator("input").fill("Vasco");
    await nameDialog.getByRole("button", { name: "OK" }).tap();
  }
  await expect(shareDialog).toBeVisible({ timeout: 60_000 });
  await expect(shareDialog.getByRole("textbox", { name: "Share link" })).toHaveValue(/#join=/);
  const copy = shareDialog.getByRole("button", { name: "Copy link" });
  await expectTappable(copy);
  await expectTappable(shareDialog.getByRole("button", { name: "Done" }));
});

test("an app opened from the switcher keeps the switcher reachable", async ({ page }) => {
  await openApp(page, "garden", "Garden");
  // A synced app's header carries the most: name, provenance, sync pill, the report control. It
  // must still fit — once it did not, the page scrolled sideways and every fixed sheet grew with it,
  // so the switcher's close button sat off the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const overlay = await openSwitcher(page);
  await expectTappable(overlay.getByRole("button", { name: "Close launcher" }));
  await overlay.getByRole("button", { name: "Close launcher" }).tap();
  await expect(overlay).toHaveCount(0);
});

test("offline, a synced app's header still fits the phone, and still says it is offline", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/^WebSocket connection to 'ws:\/\/127\.0\.0\.1:9\/' failed/, "the relay is pointed at a port nothing can answer on, on purpose: this is the offline case");
  // The relay cannot be reached — a train, a dead router. The status then says the most it ever
  // says ("Offline · changes saved here"), and on a 375-pixel phone that pushed the ⋯ menu past the
  // edge: the page scrolled sideways and the app's name was squeezed to nothing.
  await page.addInitScript(() => localStorage.setItem("potyro:sync:relay", "ws://127.0.0.1:9"));
  await openApp(page, "garden", "Garden");
  const status = page.locator(".k-topbar .k-sync-status");
  await expect(status).toHaveAttribute("data-state", "offline", { timeout: 20_000 });

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await expectTappable(page.locator(".k-topbar .k-menu-btn"));
  // The name keeps room to be read.
  expect((await page.locator(".k-topbar-name").boundingBox())!.width).toBeGreaterThan(40);
  // Short on screen, whole for anyone who asks: the words are still there to be read out and hovered.
  await expect(status).toHaveAccessibleName(/Offline · changes saved here/);
  await expect(status).toHaveAttribute("title", "Offline · changes saved here");
});
