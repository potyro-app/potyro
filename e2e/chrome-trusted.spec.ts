import { test, expect, type Page } from "@playwright/test";

// The app's chrome (#111, #87). On a phone: a compact top bar, the page, a floating quick action,
// a bottom tab bar with More; the shell's tools behind one ⋯ menu; no TRUSTED pill. On a wide
// screen: a sidebar with the pages, the quick actions and the tools. A detail page has one filled
// action and keeps Edit / Delete behind "More actions".

async function openRecipes(page: Page): Promise<void> {
  await page.goto("/?user=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
  await expect(page.locator(".k-list-row").first()).toBeVisible();
}

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the first row is near the top; the tools are behind one menu; every page is reachable", async ({ page }) => {
    await openRecipes(page);
    const row = (await page.locator(".k-list-row").first().boundingBox())!;
    expect(row.y).toBeLessThanOrEqual(120);
    // No provenance pill, and no shell tool above the content.
    await expect(page.locator(".k-prov")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Studio" })).toHaveCount(0);
    await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted");

    // The ⋯ menu holds the other quick action, the tools, and the report / trust lines.
    await page.getByRole("button", { name: "More", exact: true }).tap();
    const menu = page.getByRole("menu", { name: "More" });
    await expect(menu.getByRole("menuitem")).toHaveText([/New Ingredient/, /Studio/, /Edit mode/, /History/, /Data/, /Import/, /Export/, /Something's wrong/, /Runs directly/]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // Four pages in the bar, the rest behind More — and each of the eight is reachable.
    const bar = page.locator(".k-tabbar");
    await expect(bar.locator(".k-tab .k-tab-label")).toHaveText(["Recipes", "What can I cook?", "High protein", "Plant-based", "More"]);
    await bar.getByRole("button", { name: "More pages" }).tap();
    const more = page.getByRole("menu", { name: "More pages" });
    await expect(more.getByRole("menuitem")).toHaveText([/Ready to cook/, /Cookbook/, /Ingredients/, /In season/]);
    await more.getByRole("menuitem", { name: /Ingredients/ }).tap();
    await expect(page.locator(".k-list-row").first()).toContainText(/./);
    await expect(bar.locator(".k-tab-more-active")).toHaveCount(1);
    // On the Ingredients page the floating action is the ingredient's.
    await expect(page.locator(".k-fab")).toHaveText(/New Ingredient/);
  });

  test("the floating action runs the page's quick action; held, it offers the others", async ({ page }) => {
    await openRecipes(page);
    const fab = page.locator(".k-fab");
    await expect(fab).toHaveText(/New Recipe/);
    const box = (await fab.boundingBox())!;
    expect(box.y + box.height).toBeLessThan(812 - 60); // above the tab bar
    expect(box.height).toBeGreaterThanOrEqual(44);
    await fab.tap();
    await expect(page.getByRole("dialog", { name: "New Recipe" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Hold: the other quick action rises above it.
    const b = (await fab.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
    await page.waitForTimeout(600);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const dial = page.getByRole("group", { name: "Quick actions" });
    await expect(dial).toBeVisible();
    await dial.getByRole("button", { name: /New Ingredient/ }).tap();
    await expect(page.getByRole("dialog", { name: "New Ingredient" })).toBeVisible();
  });

  test("a detail page: back in the top bar, one filled action, Delete last in More actions", async ({ page }) => {
    await openRecipes(page);
    await page.locator(".k-list-row .k-list-text").first().tap();
    const detail = page.locator("article.k-detail");
    await expect(detail).toBeVisible();
    await expect(page.locator(".k-fab")).toHaveCount(0);
    await expect(detail.locator(".k-detail-actions .k-primary-action")).toHaveText("Cook");
    await expect(detail.locator(".k-detail-actions .k-primary-action")).toHaveCount(1);
    await detail.getByRole("button", { name: "More actions" }).tap();
    const menu = page.getByRole("menu", { name: "More actions" });
    await expect(menu.getByRole("menuitem")).toHaveText([/Edit/, /Delete/]);
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toHaveClass(/k-danger/);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back" }).tap();
    await expect(page.locator(".k-list-row").first()).toBeVisible();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a sidebar with the pages, the quick actions and the tools; the content column has no top strip", async ({ page }) => {
    await openRecipes(page);
    const side = page.locator(".k-sidebar");
    await expect(side.locator(".k-sidenav .k-tab")).toHaveCount(8);
    await expect(side.locator(".k-quickbar .k-quick")).toHaveText([/New Recipe/, /New Ingredient/]);
    await expect(side.locator(".k-quickbar .k-primary-action")).toHaveText(/New Recipe/);
    await expect(side.locator(".k-tools .k-tool")).toHaveText([/Studio/, /Edit mode/, /History/, /Data/, /Import/, /Export/, /Something's wrong/, /Runs directly/, /All apps/]);
    await expect(page.locator(".k-topbar")).toHaveCount(0);
    await expect(page.locator(".k-page-title")).toHaveText("Recipes");
    // The primary quick action follows the page.
    await side.getByRole("button", { name: "Ingredients" }).click();
    await expect(side.locator(".k-quickbar .k-primary-action")).toHaveText(/New Ingredient/);
  });

  test("an object-grid app lists Home first", async ({ page }) => {
    await page.goto("/?user=workout");
    await expect(page.locator("h1").first()).toHaveText("PPL Log", { timeout: 30_000 });
    await expect(page.locator(".k-sidenav .k-tab").first()).toHaveText(/Home/);
    await expect(page.locator(".k-sidenav .k-tab").first()).toHaveAttribute("data-active", "true");
  });
});
