import { test, expect, type Page } from "./console-guard";
import { installGridApp } from "./grid-fixture.js";

// The app's chrome (#111, #87). On a phone: a compact top bar, the page, a floating quick action,
// a bottom tab bar with More; the shell's tools behind one ⋯ menu; no TRUSTED pill. On a wide
// screen: a sidebar with the pages, the quick actions and the tools. A page with a primary action
// shows it as its one big button instead of the floating one. A detail page has one filled action
// and keeps Edit / Delete behind "More actions".
//
// Recipes is the vehicle: its cookbook (a gallery with "Add a recipe" as its primary action), "What
// can I cook?" (a list with the floating quick action), and a recipe's page.

async function openRecipes(page: Page): Promise<void> {
  await page.goto("/?user=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
  await expect(page.locator(".k-card").first()).toBeVisible();
}

/** The tools, in the order the ⋯ menu and the sidebar list them. */
const TOOLS = ["Ask", "Studio", "Edit mode", "History", "Share", "Data", "Import", "Export", "Something's wrong", "Runs as yours"];

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the page's one button and first card are on the first screen; the tools are behind one menu; every page is reachable", async ({ page }) => {
    await openRecipes(page);
    // The page's header (its title, figures and its one button) sits between the top bar and the
    // cards: the button in the top half, the first card still on the first screen.
    await expect(page.locator(".k-page-hero .k-page-title")).toHaveText("Recipes");
    const cta = (await page.locator(".k-page-hero .k-cta").boundingBox())!;
    expect(cta.y).toBeLessThanOrEqual(812 / 2);
    const card = (await page.locator(".k-card").first().boundingBox())!;
    expect(card.y).toBeLessThan(812 - 80);
    // A page with a primary action has no floating one.
    await expect(page.locator(".k-fab")).toHaveCount(0);
    // No provenance pill, and no shell tool above the content.
    await expect(page.locator(".k-prov")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Studio" })).toHaveCount(0);
    await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted");

    // The ⋯ menu holds the tools and the report / trust lines, in order.
    await page.getByRole("button", { name: "More", exact: true }).tap();
    const menu = page.getByRole("menu", { name: "More" });
    await expect(menu.getByRole("menuitem").first()).toBeVisible();
    const items = (await menu.getByRole("menuitem").allTextContents()).map((t) => t.trim());
    const tools = items.map((t) => TOOLS.find((w) => t.startsWith(w))).filter(Boolean);
    expect(tools).toEqual(TOOLS);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // Four pages in the bar, the rest behind More — and each of the seven is reachable.
    const bar = page.locator(".k-tabbar");
    await expect(bar.locator(".k-tab .k-tab-label")).toHaveText(["Recipes", "What can I cook?", "This week", "Shopping", "More"]);
    await bar.getByRole("button", { name: "More pages" }).tap();
    const more = page.getByRole("menu", { name: "More pages" });
    await expect(more.getByRole("menuitem")).toHaveText([/Ingredients/, /Cookbook/, /High protein/]);
    await more.getByRole("menuitem", { name: /Ingredients/ }).tap();
    await expect(page.locator(".k-list-row").first()).toContainText(/./);
    await expect(bar.locator(".k-tab-more-active")).toHaveCount(1);
    // On the Ingredients page the floating action is the ingredient's.
    await expect(page.locator(".k-fab")).toHaveText(/Add: Ingredient/);
  });

  test("the floating action runs the page's quick action; held, it offers the others", async ({ page }) => {
    await openRecipes(page);
    await page.locator(".k-tabbar .k-tab", { hasText: "What can I cook?" }).tap();
    await expect(page.locator(".k-list-row").first()).toBeVisible();
    const fab = page.locator(".k-fab");
    await expect(fab).toHaveText(/Add: Recipe/);
    const box = (await fab.boundingBox())!;
    expect(box.y + box.height).toBeLessThan(812 - 60); // above the tab bar
    expect(box.height).toBeGreaterThanOrEqual(44);
    await fab.tap();
    await expect(page.getByRole("dialog", { name: "Add: Recipe" })).toBeVisible();
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
    await dial.getByRole("button", { name: /Add: Ingredient/ }).tap();
    await expect(page.getByRole("dialog", { name: "Add: Ingredient" })).toBeVisible();
  });

  test("a detail page: back in the top bar, one big button on the cover, Delete last in More actions", async ({ page }) => {
    await openRecipes(page);
    await page.locator(".k-card").first().tap();
    const detail = page.locator("article.k-detail");
    await expect(detail).toBeVisible();
    await expect(page.locator(".k-fab")).toHaveCount(0);
    // The page's primary action is the cover's one loud button; the bar's actions are all quiet.
    await expect(detail.locator(".k-cta")).toHaveText(/Start cooking/);
    await expect(detail.locator(".k-cta")).toHaveCount(1);
    await expect(detail.locator(".k-detail-actions .k-primary-action")).toHaveCount(0);
    await detail.getByRole("button", { name: "More actions" }).tap();
    const menu = page.getByRole("menu", { name: "More actions" });
    await expect(menu.getByRole("menuitem").last()).toHaveText(/Delete/);
    await expect(menu.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toHaveClass(/k-danger/);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back" }).tap();
    await expect(page.locator(".k-card").first()).toBeVisible();
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a sidebar with the pages, the quick actions and the tools; the content column has no top strip", async ({ page }) => {
    await openRecipes(page);
    const side = page.locator(".k-sidebar");
    await expect(side.locator(".k-sidenav .k-tab")).toHaveCount(7);
    await expect(side.locator(".k-quickbar .k-quick")).toHaveText([/Add: Recipe/, /Add: Ingredient/]);
    await expect(side.locator(".k-tools .k-tool")).toHaveText([...TOOLS.map((t) => new RegExp(t)), /All apps/]);
    await expect(page.locator(".k-topbar")).toHaveCount(0);
    await expect(page.locator(".k-page-title")).toHaveText("Recipes");
    // The primary quick action follows the page.
    await side.getByRole("button", { name: "Ingredients" }).click();
    await expect(side.locator(".k-quickbar .k-primary-action")).toHaveText(/Add: Ingredient/);
  });

  test("an object-grid app lists Home first", async ({ page }) => {
    await installGridApp(page);
    await page.goto("/?user=gridhome");
    await expect(page.locator("h1").first()).toHaveText("Gym Notes", { timeout: 30_000 });
    await expect(page.locator(".k-sidenav .k-tab").first()).toHaveText(/Home/);
    await expect(page.locator(".k-sidenav .k-tab").first()).toHaveAttribute("data-active", "true");
  });
});
