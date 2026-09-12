import { test, expect, type Page } from "@playwright/test";

// Page layouts (#105). Plants opens on "Today": a grid of the watering figures, the overdue list
// and this month's calendar — three views on one page, three columns on a wide page, one column
// on a phone. Recipes' first page is a split: on a wide screen a row fills the recipe beside the
// list; on a phone the row opens the recipe page, as any list does.

async function open(page: Page, app: string, title: string): Promise<void> {
  await page.goto(`/?user=${app}`);
  await expect(page.locator("h1").first()).toHaveText(title, { timeout: 30_000 });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Plants' Today page is a grid of three views, in three columns", async ({ page }) => {
    await open(page, "plants", "Plants");
    await expect(page.locator(".k-page-title")).toHaveText("Today");
    const grid = page.locator(".k-layout-grid");
    await expect(grid.locator(".k-layout-title")).toHaveText(["Watering", "Overdue", "This month"]);
    // The figures (an aggregate), the overdue plant (a list) and the calendar, each its own view.
    await expect(grid.getByRole("region", { name: "Watering" })).toContainText("Due now");
    await expect(grid.getByRole("region", { name: "Overdue" }).locator(".k-list-row")).toContainText([/Fern/]);
    await expect(grid.getByRole("region", { name: "This month" }).locator(".k-cal-event").first()).toBeVisible();
    // Three columns: the calendar spans the row under the two above it.
    const watering = (await grid.getByRole("region", { name: "Watering" }).boundingBox())!;
    const overdue = (await grid.getByRole("region", { name: "Overdue" }).boundingBox())!;
    const month = (await grid.getByRole("region", { name: "This month" }).boundingBox())!;
    expect(Math.abs(watering.y - overdue.y)).toBeLessThan(2);
    expect(overdue.width).toBeGreaterThan(watering.width * 1.6);
    expect(month.y).toBeGreaterThan(watering.y + watering.height - 1);
    expect(month.width).toBeGreaterThan(overdue.width + watering.width - 2);
    // Watering from the Overdue block patches the record through the item's own view.
    await grid.getByRole("region", { name: "Overdue" }).getByRole("button", { name: "Water" }).first().click();
    await expect(grid.getByRole("region", { name: "Overdue" }).locator(".k-list-row", { hasText: "Fern" })).toHaveCount(0);
  });

  test("Recipes' split: a row fills the recipe on the right without leaving the page", async ({ page }) => {
    await open(page, "recipes", "Recipes");
    const split = page.locator(".k-layout-split");
    await expect(split).toHaveAttribute("data-wide", "true");
    await expect(split.locator(".k-layout-empty")).toHaveText("Choose one on the left.");
    await split.locator(".k-list-row .k-list-text").first().click();
    const detail = split.locator("article.k-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".k-detail-title")).toHaveText("Chicken Caesar");
    await expect(split.locator(".k-list-row[data-active='true']")).toContainText("Chicken Caesar");
    // Still the Recipes page, with its list beside the record.
    await expect(page.locator(".k-page-title")).toHaveText("Recipes");
    await expect(split.locator(".k-list-row")).toHaveCount(2);
    await split.locator(".k-list-row .k-list-text").nth(1).click();
    await expect(detail.locator(".k-detail-title")).toHaveText("Fluffy Pancakes");
    // The record's actions are its own: Cook leaves for the cook-along page.
    await detail.getByRole("button", { name: "Cook", exact: true }).click();
    await expect(page.locator("#cook-heading")).toContainText("Cooking:");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the grid stacks into one column, and the split's rows navigate", async ({ page }) => {
    await open(page, "plants", "Plants");
    const grid = page.locator(".k-layout-grid");
    const watering = (await grid.getByRole("region", { name: "Watering" }).boundingBox())!;
    const overdue = (await grid.getByRole("region", { name: "Overdue" }).boundingBox())!;
    expect(overdue.y).toBeGreaterThan(watering.y + watering.height - 1);
    expect(Math.abs(overdue.width - watering.width)).toBeLessThan(2);

    await open(page, "recipes", "Recipes");
    await expect(page.locator(".k-layout-split")).not.toHaveAttribute("data-wide", "true");
    await expect(page.locator(".k-layout-split article.k-detail")).toHaveCount(0);
    await page.locator(".k-list-row .k-list-text").first().tap();
    await expect(page.locator("article.k-detail")).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  });
});
