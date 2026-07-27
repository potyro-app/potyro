import { test, expect } from "@playwright/test";

// Quick actions (④): "Start session" picks the day inline (instant menu), creates the session with
// field defaults applied (date = ctx.now()), and OPENS its detail — "press a button, select the
// type, and you're in it". "New exercise" (other required fields) falls back to the create form.

test("workout quick action starts a session via the instant menu and opens it", async ({ page }) => {
  await page.goto("/?app=workout");
  await expect(page.locator("h1").first()).toHaveText("PPL Log");

  // Instant menu (single required enum, no other required-without-default fields): pick the day.
  await page.locator(".k-quickbar").getByRole("button", { name: /Start session/ }).click();
  const menu = page.locator(".k-quickmenu");
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "push", exact: true }).click();

  // Create-and-open: we land on the new session's detail view.
  await expect(page.locator("article.k-detail")).toBeVisible();
});

test("workout 'New exercise' quick action opens the create form", async ({ page }) => {
  await page.goto("/?app=workout");
  await page.locator(".k-quickbar").getByRole("button", { name: /New exercise/ }).click();
  const modal = page.locator(".k-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("button", { name: "Create" })).toBeVisible(); // a create form, not a menu
});
