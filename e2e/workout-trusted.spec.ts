import { test, expect } from "@playwright/test";
// A one-screen app whose quick action is a MENU: one required enum, everything else defaulted —
// the shape that makes "press the button, pick the type, and you are in it" possible. It lives here
// rather than in an example because it is a platform behaviour: PPL Log used to carry it, until
// "Start session" was removed for creating an empty session and dropping you on its record page.
const MENU_APP = `import { defineApp } from "karta";
export default defineApp({
  id: "logger", name: "Logger", icon: "\u25CE", version: "1.0.0", schemaVersion: 1,
  quickActions: [{ id: "start", label: "Start session", icon: "\u25B6", entity: "session", mode: "menu", open: true }],
  entities: {
    session: {
      label: "Session", icon: "\u25CE", displayField: "day",
      fields: {
        day: { type: "enum", options: ["push", "pull", "legs"], required: true },
        date: { type: "datetime", default: (ctx) => ctx.now() },
        note: { type: "text" },
      },
    },
  },
  pages: [
    { id: "all", title: "Sessions", view: { type: "list", entity: "session", display: { primary: "day" }, onOpen: { page: "one", param: { sessionId: "id" } } } },
    { id: "one", title: "Session", hidden: true, view: { type: "detail", entity: "session", param: "sessionId" } },
  ],
});
`;

const seedMenuApp = async (page: import("@playwright/test").Page, trusted: boolean): Promise<void> => {
  await page.addInitScript(
    ([source, t]) => {
      if (localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([{ id: "logger", name: "Logger", source, trusted: t, updatedAt: new Date().toISOString() }]),
      );
    },
    [MENU_APP, trusted] as const,
  );
};


// Quick actions (④): a MENU action picks the type inline, creates the record with field defaults
// applied (date = ctx.now()), and OPENS it — "press a button, select the type, and you're in it".
// "New exercise" (other required fields) falls back to the create form.
//
// The menu half runs against a fixture rather than PPL Log: that app's "Start session" was removed
// for creating an empty session and dropping you on its record page, which is not the flow the
// Train tab gives you. The platform behaviour still needs covering; the example no longer shows it.

test("a menu quick action creates the record from its defaults and opens it", async ({ page }) => {
  await seedMenuApp(page, true);
  await page.goto("/?user=logger");
  await expect(page.locator("h1").first()).toHaveText("Logger", { timeout: 30_000 });

  // Instant menu (a single required enum, nothing else required without a default): pick the type.
  await page.locator(".k-quickbar").getByRole("button", { name: /Start session/ }).click();
  const menu = page.locator(".k-quickmenu");
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "push", exact: true }).click();

  // Create-and-open: we land on the new record's detail view.
  await expect(page.locator("article.k-detail")).toBeVisible();
});

test("workout grid home shows object tiles and opens an object", async ({ page }) => {
  await page.goto("/?app=workout");
  const grid = page.locator(".k-objgrid");
  await expect(grid).toBeVisible(); // grid nav: lands on the object overview, not a tab

  // A tile per object type (icon + label + count).
  await expect(grid.getByRole("button", { name: /Exercise/ })).toBeVisible();
  const sessionTile = grid.getByRole("button", { name: /Session/ });
  await expect(sessionTile).toBeVisible();

  // Opening a tile leaves the grid for that object; the "⊞ Home" tab returns to it.
  await sessionTile.click();
  await expect(grid).toBeHidden();
  await page.locator(".k-nav").getByRole("button", { name: /Home/ }).click();
  await expect(grid).toBeVisible();
});

test("workout 'New exercise' quick action opens the create form", async ({ page }) => {
  await page.goto("/?app=workout");
  await page.locator(".k-quickbar").getByRole("button", { name: /New exercise/ }).click();
  const modal = page.locator(".k-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("button", { name: "Create" })).toBeVisible(); // a create form, not a menu
});
