import { test, expect } from "../console-guard";
import { expectTappable, openHome, seed, useStart } from "./fixture.js";
import { NEEDS_CDP } from "../engines";

// The Tiles home screen (the Start style), chosen in Look; Classic is the default (#96).
test.beforeEach(async ({ page }) => {
  await useStart(page);
});

// All apps (#96): every app by name, a letter over each run of them, and a tap on a letter to jump —
// Windows Phone's app list. It stays alphabetical whatever the wall looks like: groups are the wall's.

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test("alphabetical under letters; a letter opens the jump grid and a letter there jumps to it", async ({ page }) => {
  const home = await openHome(page);
  await home.getByRole("tab", { name: "All apps" }).tap();
  const names = await page.locator(".k-metro-row .k-launch-name").allInnerTexts();
  expect(names.length).toBeGreaterThanOrEqual(12);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));

  const g = page.locator('.k-metro-letter[data-letter="G"]');
  await expectTappable(g);
  await g.tap();
  const jump = page.getByRole("dialog", { name: "Jump to a letter" });
  await expect(jump).toBeVisible();
  // Letters with no app are there, and cannot be chosen.
  await expect(jump.getByRole("button", { name: "x", exact: true })).toBeDisabled();
  await jump.getByRole("button", { name: "t", exact: true }).tap();
  await expect(jump).toHaveCount(0);
  const t = page.locator('.k-metro-letter[data-letter="T"]');
  await expect(t).toBeFocused();
  await expect(t).toBeInViewport();
  // The first app under T is right below it.
  await expect(page.locator(".k-metro-letter-group", { has: t }).locator(".k-launch-name").first()).toHaveText("Tasks");
});

test("a swipe moves between Start and All apps, like a pivot", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", NEEDS_CDP);
  const home = await openHome(page);
  await expect(home.locator(".k-metro-wall")).toBeVisible();
  const box = (await home.locator(".k-metro-pane").boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + 40;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 300, y }] });
  for (let x = 280; x >= 120; x -= 40) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await expect(home.getByRole("tab", { name: "All apps" })).toHaveAttribute("aria-selected", "true");
});
