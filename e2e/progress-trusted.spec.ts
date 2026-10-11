import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Stats and a chart (#109). Workout's Progress page: tiles for this week against last week, and a
// bar chart of sessions per week. The clock is fixed so the seeded history lands in known weeks —
// Wednesday 9 September, so this week holds one session and last week two.

const NOW = new Date(2026, 8, 9, 12, 0, 0);
const SHOTS = process.env.POTYRO_SHOTS;

async function openProgress(page: Page, phone = false): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto("/?user=workout");
  await expect(page.locator("h1").first()).toHaveText("PPL Log", { timeout: 30_000 });
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
  await expect(page.locator(".k-chart-bar")).toHaveCount(8, { timeout: 30_000 });
}

const tile = (page: Page, label: string) => page.locator(".k-stat", { hasText: label });

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("tiles compare this week with last; the chart has a bar a week, a label on the latest, and a table", async ({ page }) => {
    await openProgress(page);
    await expect(tile(page, "Sessions this week").locator(".k-stat-value")).toHaveText("1");
    await expect(tile(page, "Sessions this week").locator(".k-stat-compare")).toHaveText("▼ 1 less than last week");
    await expect(tile(page, "Volume this week").locator(".k-stat-value")).toHaveText("2,185 kg");
    await expect(tile(page, "Volume this week").locator(".k-stat-compare")).toHaveText("▼ 39% less than last week");
    await expect(tile(page, "Average session").locator(".k-stat-value")).toHaveText("58 min");

    await expect(page.locator(".k-chart-title")).toHaveText("Sessions per week");
    await expect(page.locator(".k-chart-latest")).toHaveText("1");
    // The same numbers for a screen reader, oldest week first.
    const cells = page.locator(".k-chart table tbody tr");
    await expect(cells).toHaveCount(8);
    await expect(cells.first()).toHaveText(/20 Jul\s*3 sessions/);
    await expect(cells.last()).toHaveText(/7 Sep\s*1 session$/);
    // Bars are as tall as their values: the 3s share a top, the latest is a third of it.
    const box = async (i: number) => (await page.locator(".k-chart-bar").nth(i).boundingBox())!;
    const [three, one] = [await box(0), await box(7)];
    expect(Math.abs(three.height - 3 * one.height)).toBeLessThan(2);
    expect(Math.abs(three.y + three.height - (one.y + one.height))).toBeLessThan(1);

    // Hover answers for any bar; the arrow keys walk them.
    const hit = page.locator(".k-chart-hit").nth(4);
    await hit.hover();
    await expect(page.locator(".k-chart-tip")).toHaveText("17 Aug · 3 sessions");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/progress-desktop.png` });
    await page.mouse.move(5, 5);
    await expect(page.locator(".k-chart-tip")).toHaveCount(0);
    await page.locator(".k-chart-plot").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".k-chart-tip")).toHaveText("7 Sep · 1 session");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".k-chart-tip")).toHaveText("31 Aug · 2 sessions");
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
    const chart = (await page.locator(".k-chart").boundingBox())!;
    expect(chart.x).toBeGreaterThanOrEqual(0);
    expect(chart.x + chart.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.locator(".k-chart-hit").nth(1).tap();
    await expect(page.locator(".k-chart-tip")).toHaveText("27 Jul · 2 sessions");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/progress-phone.png`, fullPage: true });
    await page.locator(".k-chart-hit").nth(1).tap();
    await expect(page.locator(".k-chart-tip")).toHaveCount(0);
  });
});
