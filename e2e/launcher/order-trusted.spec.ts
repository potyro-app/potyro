import { test, expect, type Locator, type Page } from "@playwright/test";
import { tileAction } from "../launcher-actions.js";
import { openApp, openHome, seed } from "./fixture.js";

// The launcher's order (#84). It used to be a tuple, then "last edited first". Now: what you open
// often and lately comes first; what you pin comes before that, in the order you put it; and you
// can ask for A–Z or take the order into your own hands, by finger or by keyboard.

const keysIn = (section: Locator) => section.locator(".k-launch-item").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.key));
const pinnedSection = (page: Page) => page.getByRole("region", { name: "Pinned" });
const restSection = (page: Page) => page.getByRole("region", { name: /^(Apps|Everything else|Examples to try)$/ });

/** A finger: hold, then move, then let go — through CDP so the pointer events say `touch`. */
async function touchDrag(page: Page, from: Locator, to: Locator): Promise<void> {
  // A pin or a flick may have scrolled the page; a finger can only land on what is on screen.
  await from.scrollIntoViewIfNeeded();
  await to.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const end = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  await page.waitForTimeout(350); // the hold that tells a drag from a scroll
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + ((end.x - start.x) * i) / steps, y: start.y + ((end.y - start.y) * i) / steps }] });
    await page.waitForTimeout(30);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test("opening an app twice moves it above one opened once, on the next visit home", async ({ page }) => {
  await openApp(page, "trips", "Trips");
  await openApp(page, "books", "Books");
  await openApp(page, "books", "Books");
  await openHome(page);
  const keys = await keysIn(restSection(page));
  expect(keys.indexOf("user:books")).toBeLessThan(keys.indexOf("user:trips"));
  // The never-opened come after, and Recent is what is pressed.
  expect(keys.indexOf("user:trips")).toBeLessThan(keys.indexOf("user:garden"));
  await expect(page.getByRole("button", { name: "Recent" })).toHaveAttribute("aria-pressed", "true");
});

test("a pinned app leads a Pinned row, and stays there after a reload", async ({ page }) => {
  await openHome(page);
  await expect(pinnedSection(page)).toHaveCount(0);
  await tileAction(page, "Tasks", "pin");
  await expect(pinnedSection(page)).toBeVisible();
  expect(await keysIn(pinnedSection(page))).toEqual(["user:tasks"]);
  expect(await keysIn(restSection(page))).not.toContain("user:tasks");
  await page.reload();
  await expect(pinnedSection(page)).toBeVisible();
  expect(await keysIn(pinnedSection(page))).toEqual(["user:tasks"]);
  await page.getByRole("button", { name: "Actions for Tasks" }).click();
  await expect(page.getByRole("menuitem", { name: "Unpin" })).toBeVisible();
});

test("A–Z orders by name and is remembered", async ({ page }) => {
  await openHome(page);
  await page.getByRole("button", { name: "A–Z" }).click();
  expect((await keysIn(restSection(page)))[0]).toBe("user:books");
  await page.reload();
  await expect(page.getByRole("button", { name: "A–Z" })).toHaveAttribute("aria-pressed", "true");
  expect((await keysIn(restSection(page)))[0]).toBe("user:books");
});

test.describe("reordering on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("two pinned tiles swap by finger, and by Alt+arrow", async ({ page }) => {
    await openHome(page);
    await tileAction(page, "Tasks", "pin");
    await tileAction(page, "Trips", "pin");
    expect(await keysIn(pinnedSection(page))).toEqual(["user:tasks", "user:trips"]);

    const tile = (name: string) => pinnedSection(page).locator(".k-launch-tile", { hasText: name });
    await touchDrag(page, tile("Trips"), tile("Tasks"));
    await expect.poll(() => keysIn(pinnedSection(page))).toEqual(["user:trips", "user:tasks"]);
    await page.reload();
    await expect(pinnedSection(page)).toBeVisible();
    expect(await keysIn(pinnedSection(page))).toEqual(["user:trips", "user:tasks"]);

    await tile("Tasks").focus();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect.poll(() => keysIn(pinnedSection(page))).toEqual(["user:tasks", "user:trips"]);
    await expect(pinnedSection(page).locator("[aria-live]")).toContainText("Moved Tasks to position 1 of 2");
  });

  test("Manual lets the whole grid be dragged; a scroll is not a drag", async ({ page }) => {
    await openHome(page);
    await page.getByRole("button", { name: "Manual" }).click();
    const before = await keysIn(restSection(page));
    const first = restSection(page).locator(".k-launch-tile").first();
    // A flick without the hold: the page scrolls, nothing moves.
    const box = (await first.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 40, y: box.y + 40 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 40, y: box.y - 200 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    expect(await keysIn(restSection(page))).toEqual(before);
    // A held drag moves the second tile before the first.
    const tiles = restSection(page).locator(".k-launch-tile");
    await touchDrag(page, tiles.nth(1), tiles.nth(0));
    await expect.poll(() => keysIn(restSection(page)).then((k) => k.slice(0, 2))).toEqual([before[1], before[0]]);
  });
});
