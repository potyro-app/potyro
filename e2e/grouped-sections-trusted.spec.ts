import { test, expect, type Page } from "./console-guard";

// Rows under headings and sections that fold (#108). Places' "All places" shows every category at
// once, in the enum's order, each heading with a count and folding its group away; the fold is
// remembered on this device. A recipe's Ingredients section folds on its record page, remembered too.

async function openPlaces(page: Page): Promise<void> {
  await page.goto("/?user=places");
  await expect(page.locator("h1").first()).toHaveText("Places", { timeout: 30_000 });
  await page.getByRole("button", { name: "All places", exact: true }).first().click();
  await expect(page.locator(".k-fold-group").first()).toBeVisible({ timeout: 30_000 });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("All places is grouped by category, in the enum's order, and a fold survives a reload", async ({ page }) => {
    await openPlaces(page);
    const titles = await page.locator(".k-fold-group .k-fold-title").allTextContents();
    const order = ["restaurant", "bar", "cafe", "pizza", "bakery", "museum", "park", "viewpoint", "shop", "place to stay", "other"];
    // Whatever categories the seed has, they appear in the order the enum declares.
    expect(titles.length).toBeGreaterThan(0);
    expect([...titles].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(titles);
    // Each heading counts its rows.
    const first = page.locator(".k-fold-group").first();
    const rows = await first.locator(".k-list-row").count();
    await expect(first.locator(".k-fold-count")).toHaveText(String(rows));

    // Fold it: its rows leave the page, and it stays folded after a reload.
    const head = first.locator(".k-fold-head");
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(first.locator(".k-list-row")).toHaveCount(0);
    await page.reload();
    await openPlaces(page);
    await expect(page.locator(".k-fold-group").first().locator(".k-fold-head")).toHaveAttribute("aria-expanded", "false");
  });

  test("a recipe's Ingredients section folds with its count, remembered across a reload", async ({ page }) => {
    await page.goto("/?user=recipes");
    await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
    await page.locator(".k-card").first().click();
    const detail = page.locator("article.k-detail");
    const ingredients = detail.getByRole("button", { name: /^Ingredients/ });
    await expect(ingredients).toHaveAttribute("aria-expanded", "true");
    await expect(ingredients.locator(".k-fold-count")).toHaveText(/^\d+$/);
    await ingredients.click();
    await expect(ingredients).toHaveAttribute("aria-expanded", "false");
    // A record page is not in the URL, so pick the recipe again.
    await page.reload();
    await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
    await page.locator(".k-card").first().click();
    await expect(page.locator("article.k-detail").getByRole("button", { name: /^Ingredients/ })).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("phone", () => {
  // Short, so the seeded places overflow and there is something to scroll through.
  test.use({ viewport: { width: 375, height: 460 }, hasTouch: true, isMobile: true });

  test("a group heading sticks under the top bar while its rows scroll past", async ({ page }) => {
    await page.goto("/?user=places");
    await expect(page.locator("h1").first()).toHaveText("Places", { timeout: 30_000 });
    await page.locator(".k-tabbar .k-tab", { hasText: "All places" }).first().tap();
    const group = page.locator(".k-fold-group").first();
    await expect(group).toBeVisible({ timeout: 30_000 });
    const head = group.locator(".k-fold-head");
    const bar = (await page.locator(".k-topbar").boundingBox())!;
    // Scroll to the middle of the first group.
    const groupBox = (await group.boundingBox())!;
    await page.evaluate((y) => window.scrollTo(0, y), groupBox.y + groupBox.height / 2 - bar.height);
    await page.waitForTimeout(200);
    const h = (await head.boundingBox())!;
    // Pinned just under the bar, not scrolled away and not hidden behind it.
    expect(Math.abs(h.y - (bar.y + bar.height))).toBeLessThan(6);
  });
});
