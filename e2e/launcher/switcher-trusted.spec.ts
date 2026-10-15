import { test, expect, type Page } from "../console-guard";
import { openApp, openSwitcher, seed } from "./fixture.js";

// The in-app switcher on a phone (#88): a bottom sheet with a one-line header and a compact list,
// so eight or more apps show before scrolling; a row switches; swipe down, a tap on the scrim and
// Escape all close it. "Switch to X" is a name in your head, so the search field is on the sheet's
// bottom edge, inside the thumb's reach, and does not steal focus on a phone.

const PHONE = { width: 375, height: 812 };
test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await seed(page);
});

const rowsOnScreen = (page: Page) =>
  page
    .locator(".k-launcher-overlay .k-launch-tile-row")
    .evaluateAll((els, h) => els.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= (h as number);
    }).length, PHONE.height);

test("a one-line header, eight rows in view, and a row switches app", async ({ page }) => {
  await openApp(page, "groceries", "Groceries");
  const overlay = await openSwitcher(page);
  const head = (await overlay.locator(".k-switcher-head").boundingBox())!;
  expect(head.height).toBeLessThanOrEqual(56);
  expect(await rowsOnScreen(page)).toBeGreaterThanOrEqual(8);
  // The app you are in is marked and not a target.
  const current = overlay.locator(".k-launch-tile-row", { hasText: "Groceries" });
  await expect(current).toHaveAttribute("aria-current", "true");
  await expect(current).toBeDisabled();
  // The field is there, at the bottom, and did not pop a keyboard.
  const search = overlay.getByRole("searchbox", { name: "Find an app" });
  const box = (await search.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
  expect(box.y).toBeGreaterThan(PHONE.height / 2);
  await expect(search).not.toBeFocused();

  await overlay.locator(".k-launch-tile-row", { hasText: "Trips" }).tap();
  await expect(page.locator("h1").first()).toHaveText("Trips");
});

test("typing filters the list; Enter opens the first match", async ({ page }) => {
  await openApp(page, "groceries", "Groceries");
  const overlay = await openSwitcher(page);
  await overlay.getByRole("searchbox", { name: "Find an app" }).fill("gar");
  await expect(overlay.locator(".k-launch-tile-row:not(.k-launch-tile-extra)")).toHaveCount(1);
  await expect(overlay.locator(".k-launch-tile-row", { hasText: "Garden" })).toBeVisible();
  await overlay.getByRole("searchbox", { name: "Find an app" }).press("Enter");
  await expect(page.locator("h1").first()).toHaveText("Garden");
});

test("swipe down, the scrim and Escape each close it", async ({ page }) => {
  await openApp(page, "groceries", "Groceries");
  let overlay = await openSwitcher(page);
  // A finger drags the grip down past the threshold.
  const grip = (await overlay.locator(".k-switcher-grip").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = grip.x + grip.width / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: grip.y + 10 }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: grip.y + 10 + i * 25 }] });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await expect(page.locator(".k-launcher-overlay")).toHaveCount(0);
  // A touch that starts within ~300ms of the previous one ending is a double-tap candidate to
  // Chromium's gesture recogniser and yields no click. A person does not reopen and tap that fast.
  await page.waitForTimeout(400);

  overlay = await openSwitcher(page);
  await page.locator(".k-launcher-scrim").tap({ position: { x: 20, y: 20 } });
  await expect(page.locator(".k-launcher-overlay")).toHaveCount(0);

  overlay = await openSwitcher(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".k-launcher-overlay")).toHaveCount(0);
});

test("a tile's menu is a sheet inside the screen, not a panel off its edge", async ({ page }) => {
  // It was the last menu in the app still hanging off a corner: anchored to the right of a row that
  // already ends at the screen's edge, so "Rename" and "Delete" ran off the side. The cause was one
  // line of CSS — the row centred the menu's host with a transform, and a transformed ancestor
  // becomes the containing block for `position: fixed`, which quietly shrank the sheet to that box.
  await openApp(page, "groceries", "Groceries");
  const overlay = await openSwitcher(page);
  await overlay.getByRole("button", { name: "Actions for Places" }).tap();

  const menu = page.locator(".k-tile-menu");
  await expect(menu).toBeVisible();
  // It slides up; measured while it is still moving, the bottom edge is wherever it got to.
  await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width + 0.5);
  // A sheet, so it spans the screen and sits at the bottom of it.
  expect(box.width).toBe(PHONE.width);
  expect(box.y + box.height).toBeGreaterThanOrEqual(PHONE.height - 1);
  // Every row is reachable and readable, Delete last.
  await expect(menu.getByRole("menuitem").last()).toHaveText(/Delete/);
});

