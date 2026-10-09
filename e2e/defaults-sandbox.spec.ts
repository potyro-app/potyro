import { test, expect } from "@playwright/test";
// A one-screen app whose quick action is a MENU: one required enum, everything else defaulted —
// the shape that makes "press the button, pick the type, and you are in it" possible. It lives here
// rather than in an example because it is a platform behaviour: PPL Log used to carry it, until
// "Start session" was removed for creating an empty session and dropping you on its record page.
const MENU_APP = `import { defineApp } from "potyro";
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
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "logger", name: "Logger", source, trusted: t, updatedAt: new Date().toISOString() }]),
      );
    },
    [MENU_APP, trusted] as const,
  );
};


// KA-25 untrusted: a `date` that defaults to `ctx.now()`. Inside the isolate that function never
// leaves the VM, and the quick action used to store the sentinel string "__potyro_fn__" as the date.
// The host now evaluates the default where it lives.
//
// Against a fixture, not PPL Log: that app's menu quick action was removed for creating an empty
// session and dropping you on its record page. The guarantee is the platform's, not the example's.

test("an untrusted quick action starts a record from its function default", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.clock.setFixedTime(new Date(2026, 8, 9, 12, 0, 0));
  await seedMenuApp(page, false);
  await page.goto("/?user=logger");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await page.locator(".k-quickbar").getByRole("button", { name: /Start session/ }).click();
  await page.locator(".k-quickmenu").getByRole("button", { name: "legs", exact: true }).click();
  const detail = page.locator("article.k-detail");
  await expect(detail).toBeVisible();
  await expect(detail).not.toContainText("__potyro_fn__");
  await expect(detail).toContainText(/Sep 9, 2026|9 Sep 2026|9\/9\/2026/);
});
