import { test, expect, type Page } from "./console-guard";
import { installGridApp } from "./grid-fixture.js";
import { NEEDS_CDP } from "./engines";

// The app's chrome (#111, #87). On a phone: a compact top bar, the page, a floating quick action,
// a bottom tab bar with More; the shell's tools behind one ⋯ menu; no TRUSTED pill. On a wide
// screen: a sidebar with the pages, the quick actions and the tools. A page with a primary action
// shows it as a bar at the bottom instead of the floating one. A detail page has one filled action
// and keeps Edit / Delete behind "More actions".
//
// Recipes is the vehicle: its cookbook (a gallery with "Add a recipe" as its primary action), "What
// can I cook?" (a list with the floating quick action), and a recipe's page.

async function openRecipes(page: Page): Promise<void> {
  await page.goto("/?user=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
  await expect(page.locator(".k-card").first()).toBeVisible();
}

/** Two kinds of record, each with its quick action: what the floating button and its hold need. */
const TWO_QUICK = `import { defineApp } from "potyro";
export default defineApp({
  id: "jotter", name: "Jotter", version: "1.0.0", schemaVersion: 1,
  quickActions: [
    { id: "new-note", label: "New note", icon: "📝", entity: "note", mode: "form" },
    { id: "new-task", label: "New task", icon: "✅", entity: "task", mode: "form" },
  ],
  entities: {
    note: { label: "Note", displayField: "text", fields: { text: { type: "text", required: true } } },
    task: { label: "Task", displayField: "title", fields: { title: { type: "text", required: true } } },
  },
  pages: [
    { id: "notes", title: "Notes", view: { type: "list", entity: "note" } },
    { id: "tasks", title: "Tasks", view: { type: "list", entity: "task" } },
  ],
});
`;

/** The tools, in the order the ⋯ menu and the sidebar list them. */
const TOOLS = ["Ask", "Studio", "Edit mode", "History", "Share", "Data", "Import", "Export", "Something's wrong", "Runs as yours"];

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the page's one button and first card are on the first screen; the tools are behind one menu; every page is reachable", async ({ page }) => {
    await openRecipes(page);
    // Content first: no header card between the top bar and the cards — the first card starts near
    // the top, under the search and its chips.
    await expect(page.locator(".k-page-hero")).toHaveCount(0);
    const card = (await page.locator(".k-card").first().boundingBox())!;
    expect(card.y).toBeLessThan(260);
    // Adding a recipe is not what the cookbook is for: no bottom bar, no floating button for it.
    await expect(page.locator(".k-primary-bar")).toHaveCount(0);
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
    const tools = items.map((t) => TOOLS.find((w) => t.includes(w))).filter(Boolean);
    expect(tools).toEqual(TOOLS);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // Four pages, all in the bar: nothing behind More.
    const bar = page.locator(".k-tabbar");
    await expect(bar.locator(".k-tab .k-tab-label")).toHaveText(["Recipes", "This week", "Shopping", "Pantry"]);
    await bar.locator(".k-tab", { hasText: "Pantry" }).tap();
    await expect(page.locator(".k-check-row").first()).toContainText(/./);
    // On the Pantry the floating action is the ingredient's: it adds what the page shows.
    await expect(page.locator(".k-fab")).toHaveText(/Add: Ingredient/);
  });

  test("the floating action runs the page's quick action; held, it offers the others", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", NEEDS_CDP);
    // An app that adds notes and tasks: its notes page floats the note's, and holds the task's.
    await page.addInitScript((source) => {
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "jotter", name: "Jotter", source, trusted: true, updatedAt: new Date(0).toISOString() }]));
    }, TWO_QUICK);
    await page.goto("/?user=jotter");
    const fab = page.locator(".k-fab");
    await expect(fab).toHaveText(/New note/, { timeout: 30_000 });
    const box = (await fab.boundingBox())!;
    expect(box.y + box.height).toBeLessThan(812 - 60); // above the tab bar
    expect(box.height).toBeGreaterThanOrEqual(44);
    await fab.tap();
    await expect(page.getByRole("dialog", { name: "Add: Note" })).toBeVisible();
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
    await dial.getByRole("button", { name: /New task/ }).tap();
    await expect(page.getByRole("dialog", { name: "Add: Task" })).toBeVisible();
  });

  test("a detail page: back in the top bar, one big button at the bottom, Delete last in More actions", async ({ page }) => {
    await openRecipes(page);
    await page.locator(".k-card").first().tap();
    const detail = page.locator("article.k-detail");
    await expect(detail).toBeVisible();
    await expect(page.locator(".k-fab")).toHaveCount(0);
    // The page's primary action is the one loud button, at the bottom; the bar's actions are all quiet.
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
    await expect(side.locator(".k-sidenav .k-tab")).toHaveCount(4);
    await expect(side.locator(".k-quickbar .k-quick")).toHaveText([/Add: Ingredient/]);
    await expect(side.locator(".k-tools .k-tool")).toHaveText([...TOOLS.map((t) => new RegExp(t)), /All apps/]);
    await expect(page.locator(".k-topbar")).toHaveCount(0);
    await expect(page.locator(".k-page-title")).toHaveText("Recipes");
    // The primary quick action follows the page.
    await side.getByRole("button", { name: "Pantry" }).click();
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
