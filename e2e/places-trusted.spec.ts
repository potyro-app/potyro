import { test, expect, type Page } from "./console-guard";
import { skipWithoutMaps } from "./engines";

// M3 DoD, trusted path: browse places, open a detail + run an action, see the map render markers,
// toggle the "Open now" filter chip, and use "Near me" (mocked geolocation) to filter by distance.

test.use({ geolocation: { latitude: 52.52, longitude: 13.405 }, permissions: ["geolocation"] });

async function openPlaces(page: Page): Promise<void> {
  await page.goto("/?app=places");
  await expect(page.locator("h1")).toHaveText("Places");
}

test("places app runs the M3 flow in the browser (trusted)", async ({ page }) => {
  await skipWithoutMaps(page);
  await openPlaces(page);
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted");

  // All-places list → open a place → detail → run an action.
  await page.locator(".k-tab", { hasText: "All places" }).click();
  const row = page.locator(".k-list-row", { hasText: "Corner Café" });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator("article.k-detail")).toBeVisible();
  // Labelled, not keyed: an action's key is an identifier, so the button reads "Favourite".
  await page.locator("article.k-detail").getByRole("button", { name: "Favourite" }).click(); // action runs without error
  await expect(page.locator("article.k-detail .k-facts")).toContainText("favourite");

  // Map page: the canvas renders (not the empty state → markers resolved) and the Open-now chip toggles.
  await page.locator(".k-tab", { hasText: "Map" }).click();
  await expect(page.locator(".k-map-canvas")).toBeVisible();
  await expect(page.locator(".k-map-empty")).toHaveCount(0);
  await page.locator(".k-chip", { hasText: "Open now" }).click();
  await expect(page.locator(".k-chip[data-on='true']", { hasText: "Open now" })).toBeVisible();

  // Near me: the nearby list filters by distance from the mocked geolocation.
  await page.locator(".k-tab", { hasText: "Near me" }).click();
  await page.locator(".k-chip", { hasText: "Near me" }).click();
  await expect(page.locator(".k-list-row", { hasText: "Corner Café" })).toBeVisible();
  await expect(page.locator(".k-list-row", { hasText: "Paris Bakery" })).toHaveCount(0);
});
