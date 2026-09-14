import { test, expect } from "@playwright/test";

// Stats and a chart render UNTRUSTED (#109): Workout runs in the QuickJS-WASM isolate, and every
// figure, comparison and the chart's series are folds that cross the bridge as plain values.

test("Workout's Progress runs untrusted: tiles, comparisons and the chart", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 8, 9, 12, 0, 0));
  await page.goto("/?app=workout");
  await expect(page.locator("h1").first()).toHaveText("PPL Log", { timeout: 30_000 });
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");
  await page.locator(".k-sidenav .k-tab", { hasText: "Progress" }).click();

  await expect(page.locator(".k-stat", { hasText: "Volume this week" }).locator(".k-stat-value")).toHaveText("2,185 kg", { timeout: 30_000 });
  await expect(page.locator(".k-stat", { hasText: "Sessions this week" }).locator(".k-stat-compare")).toHaveText("▼ 1 less than last week");
  await expect(page.locator(".k-chart-bar")).toHaveCount(8);
  await expect(page.locator(".k-chart table tbody tr").last()).toHaveText(/7 Sep\s*1 session$/);
});
