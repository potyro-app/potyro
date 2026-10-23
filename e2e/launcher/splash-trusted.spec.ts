import { test, expect } from "../console-guard";
import { seed } from "./fixture.js";
import { NEEDS_CDP } from "../engines";

// What is on screen while an app opens (#89).
//
// It used to be the words `Opening "Groceries"…` in the top-left corner of a blank page, which
// reads as a page that failed rather than one that is loading. It is the app's own tile now —
// centred, in the colour and glyph it wears in the launcher — with its name and something moving.

const PHONE = { width: 390, height: 780 };
test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

test("opening an app shows its tile, its name and a moving bar, in the middle of the screen", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", NEEDS_CDP);
  await seed(page);
  // Opening is a second on a phone and a blink on this machine, so slow the machine down: without
  // this the splash is gone before it can be looked at, which is also why it had never been seen.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });

  // A bundled example, not one of the fixture's stubs: it declares an icon and an accent, which is
  // what the splash is meant to wear.
  await page.goto("/?user=plants");
  const splash = page.locator(".k-splash");
  await splash.waitFor({ timeout: 30_000 });

  // The app, named and pictured: the same glyph the tile carries, not a monogram fallback.
  await expect(splash).toContainText("Plants");
  await expect(splash).toContainText("Opening");
  // The icon the app declares, read out of its source and drawn the system's way (#425: a Lucide
  // name, `icon: "sprout"`) — not the monogram fallback, and never the name as text.
  await expect(splash.locator(".k-splash-tile svg[data-icon='sprout'] path")).toBeAttached();
  await expect(splash.locator(".k-splash-tile")).not.toContainText("sprout");
  await expect(splash.locator(".k-splash-tile")).toHaveClass(/k-splash-tile-icon/);

  // In the middle, not in a corner.
  const box = (await splash.locator(".k-splash-body").boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - PHONE.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y + box.height / 2 - PHONE.height / 2)).toBeLessThanOrEqual(24);

  // And something is moving while you wait.
  const moving = await splash.locator(".k-splash-bar").evaluate((el) => {
    const bar = getComputedStyle(el, "::after");
    return bar.animationName !== "none" && bar.animationDuration !== "0s";
  });
  expect(moving).toBe(true);

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  // It is a splash, not a destination: the app itself arrives.
  await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 60_000 });
  await expect(splash).toHaveCount(0);
});
