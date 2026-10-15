import { test, expect } from "./console-guard";

// The timeline renders UNTRUSTED (#110): Workout runs in the QuickJS-WASM isolate; the date is a
// field read off the row, and the card's display bindings come back across the bridge.

test("Workout's History timeline runs untrusted", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 8, 9, 12, 0, 0));
  await page.goto("/?app=workout");
  await expect(page.locator("h1").first()).toHaveText("PPL Log", { timeout: 30_000 });
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");
  await page.locator(".k-sidenav .k-tab", { hasText: "History" }).click();

  await expect(page.locator(".k-tl-head").first()).toHaveText("This week", { timeout: 30_000 });
  const lastWeek = page.getByRole("region", { name: "Last week, 2" });
  await expect(lastWeek.locator(".k-primary")).toHaveText(["Legs", "Push"]);
  await expect(lastWeek.locator(".k-secondary").first()).toContainText("1,410 kg");
});
