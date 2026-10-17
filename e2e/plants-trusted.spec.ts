import { test, expect, type Page } from "./console-guard";

// M2 DoD, trusted path: Today lists who wants water room by room; watering a plant (action → patches
// lastWatered → clears overdue) takes it off and puts it in the care log. A plant's page has Water as
// its bar and "Soil still wet" beside the rest of what you do there.

async function openPlants(page: Page): Promise<void> {
  await page.goto("/?app=plants");
  await expect(page.locator("h1")).toHaveText("Plants");
}

test("plants app runs the M2 flow in the browser (trusted)", async ({ page }) => {
  await openPlants(page);
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted");

  // Today's Water now block surfaces the overdue plant under its room; the water action takes it off.
  const now = page.getByRole("region", { name: "Water now" });
  const bathroom = now.locator(".k-fold-group", { hasText: "Bathroom" });
  await expect(bathroom.locator(".k-list-row", { hasText: "Fern" })).toBeVisible();
  await bathroom.locator(".k-list-row", { hasText: "Fern" }).getByRole("button", { name: "Water" }).click();
  await expect(now.locator(".k-list-row", { hasText: "Fern" })).toHaveCount(0);
  // …and the watering is in the care log.
  await page.getByRole("button", { name: "Care log", exact: true }).click();
  await expect(page.locator(".k-tl-card", { hasText: /Watered · Fern/ }).first()).toBeVisible();

  // A thirsty plant's page: Water is the bar, and the soil being still wet pushes it back two days.
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await now.locator(".k-list-row", { hasText: "Peace lily" }).locator(".k-list-text").click();
  await expect(page.locator(".k-detail-title")).toHaveText("Peace lily");
  await expect(page.locator(".k-primary-bar").getByRole("button", { name: "Water" })).toBeVisible();
  await page.getByRole("button", { name: "Soil still wet" }).click();
  await expect(page.locator(".k-detail-hero")).toContainText("Water in 2 days");
});
