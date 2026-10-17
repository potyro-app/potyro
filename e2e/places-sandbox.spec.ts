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

// The map's strip of cards, sealed: each card's photo and words are the app's `display`, resolved in
// the box — "open now" or "closed" is a function of the opening hours. (An aggregate folded sealed is
// split-sealed-sandbox.spec.ts's now: Places no longer has one.)
test("the map's cards render UNTRUSTED, their words from the app's functions", async ({ page }) => {
  await skipWithoutMaps(page);
  await page.goto("/?app=places");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");
  const cards = page.locator(".k-map-strip .k-map-card");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  await expect(cards.first().locator(".k-map-card-detail")).toContainText(/open now|closed|hours unknown/);
  expect(await cards.count()).toBeGreaterThan(1);
});
