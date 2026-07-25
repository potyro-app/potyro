import { test, expect } from "@playwright/test";

// M3 DoD, sandbox path: the places app runs UNTRUSTED in the QuickJS-WASM isolate. The All-places
// list and the Map (markers resolved via the isolate's `geo` binding + computed) both render,
// proving the map view works across the marshalling boundary.

test("places app runs untrusted in the QuickJS-WASM isolate (list + map)", async ({ page }) => {
  await page.goto("/?app=places");
  await expect(page.locator("h1")).toHaveText("Places");
  await expect(page.locator(".k-prov")).toHaveText("untrusted");

  await page.locator(".k-tab", { hasText: "All places" }).click();
  await expect(page.locator(".k-list-row").first()).toBeVisible();

  await page.locator(".k-tab", { hasText: "Map" }).click();
  await expect(page.locator(".k-map-canvas")).toBeVisible();
  await expect(page.locator(".k-map-empty")).toHaveCount(0);
});
