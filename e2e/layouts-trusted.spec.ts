import { test, expect, type Page } from "./console-guard";

// Page layouts (#105). Plants opens on "Today": a grid of the watering figures, the thirsty plants and
// what comes up this week — three views on one page, three columns on a wide page, one column on a
// phone. Places' "All places" is a split: on a wide screen a row fills the place beside the list; on
// a phone the row opens the place's page, as any list does.

async function open(page: Page, app: string, title: string): Promise<void> {
  await page.goto(`/?user=${app}`);
  await expect(page.locator("h1").first()).toHaveText(title, { timeout: 30_000 });
}

async function allPlaces(page: Page, phone = false): Promise<void> {
  await open(page, "places", "Places");
  if (phone) await page.locator(".k-tabbar .k-tab", { hasText: "All places" }).tap();
  else await page.locator(".k-sidenav .k-tab", { hasText: "All places" }).click();
  await expect(page.locator(".k-layout-split")).toBeVisible({ timeout: 30_000 });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Plants' Today page is a grid of three views, in three columns", async ({ page }) => {
    await open(page, "plants", "Plants");
    await expect(page.locator(".k-page-title")).toHaveText("Today");
    const grid = page.locator(".k-layout-grid");
    await expect(grid.locator(".k-layout-title")).toHaveText(["Watering", "Thirsty", "Coming up"]);
    // The figures (an aggregate), the thirsty plants and the week ahead (lists), each its own view.
    await expect(grid.getByRole("region", { name: "Watering" })).toContainText("Due now");
    await expect(grid.getByRole("region", { name: "Thirsty" }).locator(".k-list-row", { hasText: "Fern" })).toBeVisible();
    await expect(grid.getByRole("region", { name: "Coming up" }).locator(".k-list-row").first()).toBeVisible();
    // Three columns: the week ahead spans the row under the two above it.
    const watering = (await grid.getByRole("region", { name: "Watering" }).boundingBox())!;
    const thirsty = (await grid.getByRole("region", { name: "Thirsty" }).boundingBox())!;
    const coming = (await grid.getByRole("region", { name: "Coming up" }).boundingBox())!;
    expect(Math.abs(watering.y - thirsty.y)).toBeLessThan(2);
    expect(thirsty.width).toBeGreaterThan(watering.width * 1.6);
    expect(coming.y).toBeGreaterThan(Math.min(watering.y + watering.height, thirsty.y + thirsty.height) - 1);
    expect(coming.width).toBeGreaterThan(thirsty.width + watering.width - 2);
    // Watering from the Thirsty block patches the record through the item's own view.
    const thirstyBlock = grid.getByRole("region", { name: "Thirsty" });
    await thirstyBlock.locator(".k-list-row", { hasText: "Fern" }).getByRole("button", { name: "Water" }).click();
    await expect(thirstyBlock.locator(".k-list-row", { hasText: "Fern" })).toHaveCount(0);
  });

  test("Places' split: a row fills the place on the right without leaving the page", async ({ page }) => {
    await allPlaces(page);
    const split = page.locator(".k-layout-split");
    await expect(split).toHaveAttribute("data-wide", "true");
    await expect(split.locator(".k-layout-empty")).toHaveText("Choose one on the left.");
    const rows = split.locator(".k-list-row");
    const first = ((await rows.first().locator(".k-primary").textContent()) ?? "").trim();
    await rows.first().locator(".k-list-text").click();
    const detail = split.locator("article.k-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".k-detail-title")).toHaveText(first);
    await expect(split.locator(".k-list-row[data-active='true']")).toContainText(first);
    // Still the All places page, with its list beside the record.
    await expect(page.locator(".k-page-title")).toHaveText("All places");
    const second = ((await rows.nth(1).locator(".k-primary").textContent()) ?? "").trim();
    await rows.nth(1).locator(".k-list-text").click();
    await expect(detail.locator(".k-detail-title")).toHaveText(second);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the grid stacks into one column, and the split's rows navigate", async ({ page }) => {
    await open(page, "plants", "Plants");
    const grid = page.locator(".k-layout-grid");
    const watering = (await grid.getByRole("region", { name: "Watering" }).boundingBox())!;
    const thirsty = (await grid.getByRole("region", { name: "Thirsty" }).boundingBox())!;
    expect(thirsty.y).toBeGreaterThan(watering.y + watering.height - 1);
    expect(Math.abs(thirsty.width - watering.width)).toBeLessThan(2);

    await allPlaces(page, true);
    await expect(page.locator(".k-layout-split")).not.toHaveAttribute("data-wide", "true");
    await expect(page.locator(".k-layout-split article.k-detail")).toHaveCount(0);
    await page.locator(".k-list-row .k-list-text").first().tap();
    await expect(page.locator("article.k-detail")).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  });
});
