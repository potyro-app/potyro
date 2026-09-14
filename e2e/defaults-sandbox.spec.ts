import { test, expect } from "@playwright/test";

// KA-25 untrusted: Workout's session `date` defaults to `ctx.now()`. Inside the isolate that function
// never leaves the VM, and the quick action used to store the sentinel string "__karta_fn__" as the
// date. The host now evaluates the default where it lives.

test("an untrusted quick action starts a record from its function default", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.setFixedTime(new Date(2026, 8, 9, 12, 0, 0));
  await page.goto("/?app=workout");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await page.locator(".k-quickbar").getByRole("button", { name: /Start session/ }).click();
  await page.locator(".k-quickmenu").getByRole("button", { name: "legs", exact: true }).click();
  const detail = page.locator("article.k-detail");
  await expect(detail).toBeVisible();
  await expect(detail).not.toContainText("__karta_fn__");
  await expect(detail).toContainText(/Sep 9, 2026|9 Sep 2026|9\/9\/2026/);
});
