import { test, expect } from "./console-guard";

// M2 DoD, sandbox path: the plants app runs UNTRUSTED in the sandbox. If Today's rows render under
// their rooms and the care log's titles read, the sealed app ran its computed `overdue` and `title`
// and its `group` binding, and the results crossed the boundary.

test("plants app runs untrusted in the sandbox (Today + care log)", async ({ page }) => {
  await page.goto("/?app=plants");
  await expect(page.locator("h1")).toHaveText("Plants");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  const now = page.getByRole("region", { name: "Water now" });
  await expect(now.locator(".k-fold-group", { hasText: "Bathroom" }).locator(".k-list-row", { hasText: "Fern" })).toBeVisible();

  await page.getByRole("button", { name: "Care log", exact: true }).click();
  await expect(page.locator(".k-tl-card", { hasText: /Watered · / }).first()).toBeVisible();
});
