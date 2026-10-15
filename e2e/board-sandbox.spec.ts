import { test, expect } from "./console-guard";

// The board renders UNTRUSTED (#107): Recipes runs in the QuickJS-WASM isolate, its `sort` and
// display bindings cross the bridge as values, and a move is still a host-side patch.

test("the Cookbook board runs untrusted: columns, cards, and Move to…", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?app=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");
  await page.locator(".k-sidenav .k-tab", { hasText: "Cookbook" }).click();

  const keeper = page.locator('.k-board-col[data-board-column="keeper"]');
  await expect(keeper.locator(".k-board-card", { hasText: "Fluffy Pancakes" })).toBeVisible({ timeout: 30_000 });
  // The secondary line is a function binding, so it came back through the isolate.
  await expect(keeper.locator(".k-board-card", { hasText: "Fluffy Pancakes" }).locator(".k-secondary")).toContainText("kcal");

  await keeper.getByRole("button", { name: "Fluffy Pancakes: more" }).click();
  await page.getByRole("menuitem", { name: /Move to tried/ }).click();
  await expect(page.locator('.k-board-col[data-board-column="tried"]').locator(".k-board-card", { hasText: "Fluffy Pancakes" })).toBeVisible();
});
