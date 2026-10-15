import { test, expect } from "../console-guard";
import AxeBuilder from "@axe-core/playwright";
import { openApp, openHome, openSwitcher, seed } from "./fixture.js";
import { openTileMenu } from "../launcher-actions.js";

// Accessibility of the launcher (#94): axe on the home screen, the switcher and the open tile
// menu — zero serious or critical violations — and a reduced-motion run in which nothing animates.

const SERIOUS = new Set(["serious", "critical"]);

async function audit(page: import("@playwright/test").Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const bad = results.violations.filter((v) => SERIOUS.has(v.impact ?? ""));
  const report = bad.map((v) => `${v.impact} ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  expect(bad, `${where}:\n${report}`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await seed(page);
});

test("home has no serious or critical violations", async ({ page }) => {
  await openHome(page);
  await audit(page, "home");
});

test("the tile menu, open, has none either", async ({ page }) => {
  await openHome(page);
  await openTileMenu(page, "Groceries");
  await expect(page.getByRole("menu")).toBeVisible();
  await audit(page, "tile menu");
});

test("the in-app switcher has none", async ({ page }) => {
  await openApp(page, "groceries", "Groceries");
  await openSwitcher(page);
  await audit(page, "switcher");
});

// Dark (#92): the same three audits under `prefers-color-scheme: dark`, so a token that only reads
// on paper is caught here rather than on a phone at night.
test.describe("dark", () => {
  test.use({ colorScheme: "dark" });

  test("home has no serious or critical violations in dark", async ({ page }) => {
    await openHome(page);
    await audit(page, "home, dark");
  });

  test("the open tile menu has none in dark", async ({ page }) => {
    await openHome(page);
    await openTileMenu(page, "Groceries");
    await expect(page.getByRole("menu")).toBeVisible();
    await audit(page, "tile menu, dark");
  });

  test("the in-app switcher has none in dark", async ({ page }) => {
    await openApp(page, "groceries", "Groceries");
    await openSwitcher(page);
    await audit(page, "switcher, dark");
  });
});

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test("nothing on the launcher animates for longer than nothing", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page);
    // The bottom sheet is the launcher's one entrance animation.
    await openTileMenu(page, "Groceries");
    await expect(page.getByRole("menu")).toBeVisible();
    const longest = await page.evaluate(() =>
      Math.max(0, ...document.getAnimations().map((a) => Number(a.effect?.getComputedTiming().duration ?? 0))),
    );
    expect(longest).toBeLessThanOrEqual(1);
  });
});
