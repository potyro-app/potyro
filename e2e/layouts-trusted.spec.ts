import { test, expect, type Page } from "./console-guard";

// Page layouts (#105). Plants opens on "Today": a grid of the plants to water now and what comes up
// this week — two views on one page, side by side (two columns and one) on a wide page, one under the
// other on a phone. Places' "All places" is a split: on a wide screen a row fills the place beside the list; on
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

  test("Plants' Today page is a grid of two views, two columns and one", async ({ page }) => {
    await open(page, "plants", "Plants");
    await expect(page.locator(".k-page-title")).toHaveText("Today");
    const grid = page.locator(".k-layout-grid");
    await expect(grid.locator(".k-layout-title")).toHaveText(["Water now", "Coming up"]);
    // The plants to water now and the week ahead, each its own list view.
    const now = grid.getByRole("region", { name: "Water now" });
    await expect(now.locator(".k-list-row", { hasText: "Fern" })).toBeVisible();
    await expect(grid.getByRole("region", { name: "Coming up" }).locator(".k-list-row").first()).toBeVisible();
    // Side by side: the week ahead is the narrow column beside the wide one (span 2 + span 1).
    const wide = (await now.boundingBox())!;
    const coming = (await grid.getByRole("region", { name: "Coming up" }).boundingBox())!;
    expect(Math.abs(wide.y - coming.y)).toBeLessThan(2);
    expect(coming.x).toBeGreaterThan(wide.x + wide.width - 1);
    expect(wide.width).toBeGreaterThan(coming.width * 1.6);
    // Watering from the Water now block patches the record through the item's own view.
    await now.locator(".k-list-row", { hasText: "Fern" }).getByRole("button", { name: "Water" }).click();
    await expect(now.locator(".k-list-row", { hasText: "Fern" })).toHaveCount(0);
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
    const now = (await grid.getByRole("region", { name: "Water now" }).boundingBox())!;
    const coming = (await grid.getByRole("region", { name: "Coming up" }).boundingBox())!;
    expect(coming.y).toBeGreaterThan(now.y + now.height - 1);
    expect(Math.abs(coming.width - now.width)).toBeLessThan(2);

    await allPlaces(page, true);
    await expect(page.locator(".k-layout-split")).not.toHaveAttribute("data-wide", "true");
    await expect(page.locator(".k-layout-split article.k-detail")).toHaveCount(0);
    await page.locator(".k-list-row .k-list-text").first().tap();
    await expect(page.locator("article.k-detail")).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  });
});
