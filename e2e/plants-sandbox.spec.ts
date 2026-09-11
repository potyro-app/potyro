import { test, expect } from "@playwright/test";

// M2 DoD, sandbox path: the plants app runs UNTRUSTED in the QuickJS-WASM isolate. If the list and
// the Schedule calendar render, the isolate ran the app's computed `nextWatering` + calendar
// bindings and marshalled the results across the boundary.

test("plants app runs untrusted in the QuickJS-WASM isolate (list + calendar)", async ({ page }) => {
  await page.goto("/?app=plants");
  await expect(page.locator("h1")).toHaveText("Plants");
  await expect(page.locator(".k-prov")).toHaveText(/^untrusted/);

  await expect(page.locator(".k-list-row").first()).toBeVisible();

  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.locator(".k-calendar")).toBeVisible();
  await expect(page.locator(".k-cal-event").first()).toBeVisible();
});
