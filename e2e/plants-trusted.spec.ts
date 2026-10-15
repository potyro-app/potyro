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

  // List renders (sorted by nextWatering).
  await expect(page.locator(".k-list-row").first()).toBeVisible();

  // Due page surfaces the overdue plant; the water action removes it from Due.
  await page.getByRole("button", { name: "Due", exact: true }).click();
  const fernRow = page.locator(".k-list-row", { hasText: "Fern" });
  await expect(fernRow).toBeVisible();
  await fernRow.getByRole("button", { name: "water" }).click();
  await expect(page.locator(".k-list-row", { hasText: "Fern" })).toHaveCount(0);

  // Schedule (calendar built-in) renders with at least one event on the month grid.
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page.locator(".k-calendar")).toBeVisible();
  await expect(page.locator(".k-cal-event").first()).toBeVisible();
});
