import { test, expect } from "../console-guard";

// A sealed app's live tile (docs/04 §Tile): under `--mode sandbox` the examples are seeded as shared
// apps, so their `tile` runs in the sealed box (the browser realm) and only the data it returns comes
// out — the same face a trusted app gets, with no authority handed over.

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

test("a sealed app's tile runs in its box and its live face shows on the wall", async ({ page }) => {
  await page.goto("/");
  const groceries = page.locator('.k-metro-wall .k-metro-cell[data-key="user:groceries"]');
  await expect(groceries.locator(".k-metro-tile")).toBeVisible({ timeout: 30_000 });
  // It is sealed: the shield says so.
  await expect(groceries.getByRole("img", { name: "Runs sealed" })).toBeVisible();
  await expect(groceries.locator(".k-metro-face-live")).toContainText("5 to buy", { timeout: 45_000 });
  await expect(page.locator('.k-metro-wall .k-metro-cell[data-key="user:plants"] .k-metro-face-live')).toContainText(/\d to water/, { timeout: 45_000 });
});
