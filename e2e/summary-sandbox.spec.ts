import { test, expect, type Page } from "@playwright/test";

// KA-24, sandbox path: a page summary's `value` FUNCTION computed by an app running UNTRUSTED in
// the QuickJS-WASM isolate.
//
// This is the case that was silently broken. `computed` is per-record, so an aggregate over the
// whole set lives in `page.summary` — and for an untrusted app that function never leaves the VM:
// the extracted definition carries the `__karta_fn__` sentinel string where the function was. The
// shell called that string, threw, and the figure rendered a dash. So the one shape built-in views
// cannot express was exactly the shape an untrusted app could not compute, which is why a shared
// app's aggregate screen came up blank for the very recipients sharing exists to serve.
//
// The trusted twin of this file (`summary-trusted.spec.ts`) must keep passing unchanged: parity
// between the two runners is the actual claim (docs/09).

const figure = (page: Page, label: string) =>
  page.locator(".k-summary-figure", { hasText: label }).locator(".k-summary-value");

async function openList(page: Page): Promise<void> {
  await page.goto("/?app=places");
  await expect(page.locator("h1")).toHaveText("Places");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");
  await page.locator(".k-tab", { hasText: "All places" }).click();
  await expect(page.locator(".k-summary")).toBeVisible();
}

test("a summary value function computes inside the isolate", async ({ page }) => {
  await openList(page);

  // "Visited" is `value: (rows) => rows.filter((p) => p.visited).length` in places.app.ts — the
  // function form. Two of the three seeded places are visited. Before `callSummary` this read "–".
  await expect(figure(page, "Visited")).toHaveText("2");

  // The declarative forms were never broken; asserting them here pins the parity claim.
  await expect(figure(page, "Places")).toHaveText("3");
  await expect(figure(page, "Average rating")).toHaveText("4.5");
});

test("the isolate-computed figure tracks the filter chips", async ({ page }) => {
  await openList(page);

  // Each chip toggle re-runs the function across the marshalling boundary with the newly filtered
  // rows. A figure that went stale here would disagree with the rows beneath it.
  await page.locator(".k-chip", { hasText: "cafe" }).click();
  await expect(page.locator(".k-list-row")).toHaveCount(1);
  await expect(figure(page, "Visited")).toHaveText("1");

  await page.locator(".k-chip", { hasText: "cafe" }).click();
  await expect(figure(page, "Visited")).toHaveText("2");
});

test("an empty set still distinguishes a true zero from an unanswerable average", async ({ page }) => {
  await openList(page);

  await page.locator(".k-chip", { hasText: "pizza" }).click();
  await expect(page.locator(".k-list-row")).toHaveCount(0);

  // Zero visited places is true; an average rating over nothing is not zero, it is unanswerable.
  await expect(figure(page, "Visited")).toHaveText("0");
  await expect(figure(page, "Average rating")).toHaveText("–");
});
