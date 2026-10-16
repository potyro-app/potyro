import { test, expect, type Page } from "./console-guard";

// M2 DoD, trusted path: browse plants, see the overdue plant on the Due page, water it (action →
// patches lastWatered → clears overdue → leaves Due), and see the Schedule calendar render events.

async function openPlants(page: Page): Promise<void> {
  await page.goto("/?app=plants");
  await expect(page.locator("h1")).toHaveText("Plants");
}

test("plants app runs the M2 flow in the browser (trusted)", async ({ page }) => {
  await openPlants(page);
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted");

  // Today's Thirsty block surfaces the overdue plant; the water action takes it off.
  const thirsty = page.getByRole("region", { name: "Thirsty" });
  const fernRow = thirsty.locator(".k-list-row", { hasText: "Fern" });
  await expect(fernRow).toBeVisible();
  await fernRow.getByRole("button", { name: "water" }).click();
  await expect(thirsty.locator(".k-list-row", { hasText: "Fern" })).toHaveCount(0);
  // …and the watering is in the care log.
  await page.getByRole("button", { name: "Care log", exact: true }).click();
  await expect(page.locator(".k-tl-card", { hasText: /Watered · Fern/ }).first()).toBeVisible();

  // Schedule (calendar built-in) renders with at least one event on the month grid.
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.locator(".k-calendar")).toBeVisible();
  await expect(page.locator(".k-cal-event").first()).toBeVisible();
});
