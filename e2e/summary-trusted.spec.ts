import { chooseFilter } from "./filters.js";
import { test, expect, type Page } from "./console-guard";

// Summary figures — the shape no built-in view could express. `computed` is per-record and every
// view renders rows, so a number derived from many records had nowhere to go; three of the
// generator's own corpus prompts asked for exactly that.
//
// The property that makes the strip worth having is that it tracks the filter: a total that
// disagreed with the rows beneath it would read as a bug, so that is what this drives.

const figure = (page: Page, label: string) =>
  page.locator(".k-summary-figure", { hasText: label }).locator(".k-summary-value");

async function openList(page: Page): Promise<void> {
  await page.goto("/?app=places");
  await expect(page.locator("h1")).toHaveText("Places");
  await page.locator(".k-tab", { hasText: "All places" }).click();
  await expect(page.locator(".k-summary")).toBeVisible();
}

test("figures compute over the seeded records", async ({ page }) => {
  await openList(page);

  // Thirteen seeded places, nine of them rated (averaging 4.5), eight been to or favourites.
  await expect(figure(page, "Places")).toHaveText("13");
  await expect(figure(page, "Average rating")).toHaveText("4.5");
  await expect(figure(page, "Visited")).toHaveText("8");
});

test("figures follow the filter chips", async ({ page }) => {
  await openList(page);

  // Narrow to one category. Every figure must move with the rows — the declarative `count`/`avg`
  // and the `value` function alike.
  await chooseFilter(page, "cafe");
  await expect(page.locator(".k-list-row")).toHaveCount(2); // Corner Café and Morning Glory

  await expect(figure(page, "Places")).toHaveText("2");
  await expect(figure(page, "Average rating")).toHaveText("4.5");
  await expect(figure(page, "Visited")).toHaveText("2");

  // ...and back again when the filter is released.
  await chooseFilter(page, "cafe");
  await expect(figure(page, "Places")).toHaveText("13");
  await expect(figure(page, "Visited")).toHaveText("8");
});

test("an empty set reports zero for a count but not for an average", async ({ page }) => {
  await openList(page);

  // A filter matching nothing: "0 places" is true, but "average rating 0" would be a wrong answer
  // rather than an empty one.
  await chooseFilter(page, "museum");
  await expect(page.locator(".k-list-row")).toHaveCount(0);

  await expect(figure(page, "Places")).toHaveText("0");
  await expect(figure(page, "Visited")).toHaveText("0");
  await expect(figure(page, "Average rating")).toHaveText("–");
});

test("pages without a summary render no strip", async ({ page }) => {
  await page.goto("/?app=places");
  await expect(page.locator("h1")).toHaveText("Places");
  await page.locator(".k-tab", { hasText: "Map" }).click();
  await expect(page.locator(".k-map-canvas")).toBeVisible();
  await expect(page.locator(".k-summary")).toHaveCount(0);
});
