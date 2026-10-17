import { test, expect } from "./console-guard";
import { skipWithoutMaps } from "./engines";

// M3 DoD, sandbox path: the places app runs UNTRUSTED in the QuickJS-WASM isolate. The All-places
// list and the Map (markers resolved via the isolate's `geo` binding + computed) both render,
// proving the map view works across the marshalling boundary.

test("places app runs untrusted in the QuickJS-WASM isolate (list + map)", async ({ page }) => {
  await skipWithoutMaps(page);
  await page.goto("/?app=places");
  await expect(page.locator("h1")).toHaveText("Places");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  await page.locator(".k-tab", { hasText: "All places" }).click();
  await expect(page.locator(".k-list-row").first()).toBeVisible();

  await page.locator(".k-tab", { hasText: "Map" }).click();
  await expect(page.locator(".k-map-canvas")).toBeVisible();
  await expect(page.locator(".k-map-empty")).toHaveCount(0);
});

// KA-24, and the reason it was upstream of the whole sharing track: a screen folded out of the WHOLE
// set — "who owes whom", "places per category" — is neither per-record nor a single figure, so
// before the `aggregate` view it could only be a custom view. Custom views are trusted-only, so a
// shared app's MAIN screen rendered blank for exactly the people sharing exists to serve.
//
// This is the test that matters, and it has to be the SANDBOX one: trusted proves nothing here,
// because the trusted path could always call the function directly. The claim is that the fold runs
// in the isolate and its rows come back across the bridge.
test("an aggregate screen renders UNTRUSTED, folded inside the isolate", async ({ page }) => {
  await page.goto("/?app=places");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  await page.locator(".k-tab", { hasText: "By category" }).click();

  const rows = page.locator(".k-aggregate-row");
  await expect(rows.first()).toBeVisible();

  // Derived, not stored: no record has a "count of its category" field, so a number here can only
  // have come from the fold having actually run.
  await expect(page.locator(".k-aggregate-value").first()).toHaveText(/^\d+$/);
  await expect(page.locator(".k-aggregate-group")).toHaveText("Categories");

  // And it is the real answer, not a placeholder: the counts must add up to the rows in the list.
  const total = await rows.evaluateAll((els) =>
    els.reduce((sum, el) => sum + Number(el.querySelector(".k-aggregate-value")?.textContent ?? 0), 0),
  );
  await page.locator(".k-tab", { hasText: "All places" }).click();
  await expect(page.locator(".k-list-row")).toHaveCount(total);
});
