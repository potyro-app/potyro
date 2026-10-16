import { test, expect, type Page } from "./console-guard";
import AxeBuilder from "@axe-core/playwright";

// Stats and a chart (#109). Workout's Progress page: tiles for this week against last week, and a
// bar chart of sessions per week. The clock is fixed so the seeded history lands in known weeks —
// Wednesday 9 September, so this week holds one session and last week two.

const NOW = new Date(2026, 8, 9, 12, 0, 0);
const SHOTS = process.env.POTYRO_SHOTS;

async function openProgress(page: Page, phone = false): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto("/?user=workout");
  await expect(page.locator("h1").first()).toHaveText("Workout", { timeout: 30_000 });
  if (phone) {
    const tab = page.locator(".k-tabbar .k-tab", { hasText: "Progress" });
    if (await tab.count()) await tab.first().tap();
    else {
      await page.locator(".k-tabbar").getByRole("button", { name: /More/ }).tap();
      await page.getByRole("menuitem", { name: /Progress/ }).tap();
    }
  } else {
    await page.locator(".k-sidenav .k-tab", { hasText: "Progress" }).click();
  }
  await expect(page.locator(".k-chart").first().locator(".k-chart-bar")).toHaveCount(8, { timeout: 30_000 });
}

const tile = (page: Page, label: string) => page.locator(".k-stat", { hasText: label });

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("tiles compare this week with last; the chart has a bar a week, a label on the latest, and a table", async ({ page }) => {
    await openProgress(page);
    await expect(tile(page, "Sessions this week").locator(".k-stat-value")).toHaveText("1");
    await expect(tile(page, "Sessions this week").locator(".k-stat-compare")).toHaveText("▼ 2 less than last week");
    await expect(tile(page, "Volume this week").locator(".k-stat-value")).toHaveText("4,236.5 kg");
    await expect(tile(page, "Volume this week").locator(".k-stat-compare")).toHaveText("▼ 84% less than last week");
    await expect(tile(page, "Average session").locator(".k-stat-value")).toHaveText("68 min");

    await expect(page.locator(".k-chart-title").first()).toHaveText("Sessions per week");
    await expect(page.locator(".k-chart-latest").first()).toHaveText("1");
    // The same numbers for a screen reader, oldest week first.
    const cells = page.locator(".k-chart").first().locator("table tbody tr");
    await expect(cells).toHaveCount(8);
    await expect(cells.first()).toHaveText(/Jul 20\s*3 sessions/);
    await expect(cells.last()).toHaveText(/Sep 7\s*1 session$/);
    // Bars are as tall as their values: the 3s share a top, the latest is a third of it.
    const box = async (i: number) => (await page.locator(".k-chart").first().locator(".k-chart-bar").nth(i).boundingBox())!;
    const [three, one] = [await box(0), await box(7)];
    expect(Math.abs(three.height - 3 * one.height)).toBeLessThan(2);
    expect(Math.abs(three.y + three.height - (one.y + one.height))).toBeLessThan(1);

    // Hover answers for any bar; the arrow keys walk them.
    const hit = page.locator(".k-chart").first().locator(".k-chart-hit").nth(4);
    await hit.hover();
    await expect(page.locator(".k-chart-tip")).toHaveText("Aug 17 · 2 sessions");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/progress-desktop.png` });
    await page.mouse.move(5, 5);
    await expect(page.locator(".k-chart-tip")).toHaveCount(0);
    await page.locator(".k-chart-plot").first().focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".k-chart-tip")).toHaveText("Sep 7 · 1 session");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".k-chart-tip")).toHaveText("Aug 31 · 3 sessions");
    await page.keyboard.press("Escape");
    await expect(page.locator(".k-chart-tip")).toHaveCount(0);

    const results = await new AxeBuilder({ page }).include(".k-stats").include(".k-chart").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  });

  test("dark: the same page in the dark theme passes axe", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openProgress(page);
    const results = await new AxeBuilder({ page }).include(".k-stats").include(".k-chart").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/progress-dark.png` });
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("tiles in two columns, the chart inside the screen, and a tap shows a bar's value", async ({ page }) => {
    await openProgress(page, true);
    const a = (await page.locator(".k-stat").nth(0).boundingBox())!;
    const b = (await page.locator(".k-stat").nth(1).boundingBox())!;
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    const chart = (await page.locator(".k-chart").first().boundingBox())!;
    expect(chart.x).toBeGreaterThanOrEqual(0);
    expect(chart.x + chart.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.locator(".k-chart").first().locator(".k-chart-hit").nth(1).tap();
    await expect(page.locator(".k-chart-tip")).toHaveText("Jul 27 · 3 sessions");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/progress-phone.png`, fullPage: true });
    await page.locator(".k-chart").first().locator(".k-chart-hit").nth(1).tap();
    await expect(page.locator(".k-chart-tip")).toHaveCount(0);
  });
});
