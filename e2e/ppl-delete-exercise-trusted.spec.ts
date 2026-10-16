import { test, expect } from "./console-guard";

// The owner's report: in Workout (then PPL Log), delete an exercise from Program (Bench Press) and Program sat on
// "Loading…" for good — after a reload too, and Train with it. Past sessions still mention the
// exercise; its computed `lastBest` read the now-empty link and threw; the whole page's query failed;
// and the failure was swallowed, so the page waited forever with nothing on screen or in the console.

test("deleting an exercise past sessions mention leaves Program and Train working", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?app=workout");
  await expect(page.locator("h1").first()).toHaveText("Workout");
  await page.locator(".k-sidenav button", { hasText: "Program" }).first().click();
  const rows = page.locator(".k-list-row");
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();

  await rows.filter({ hasText: "Bench Press" }).locator(".k-list-text").click();
  await expect(page.locator(".k-detail")).toBeVisible();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.locator(".k-dialog").getByRole("button", { name: "Delete" }).click();

  // Program lists what is left, and not "Loading…". (Deleting lands on the app's first page: the
  // exercises are the second list on Program, and a delete goes back to a page whose own view lists them.)
  await page.locator(".k-sidenav button", { hasText: "Program" }).first().click();
  await expect(rows).toHaveCount(before - 1);
  await expect(rows.filter({ hasText: "Bench Press" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Loading…");

  // It stays that way after a reload, and Train (which reads the same exercises) opens too.
  await page.reload();
  await page.locator(".k-sidenav button", { hasText: "Program" }).first().click();
  await expect(rows).toHaveCount(before - 1);
  await page.locator(".k-sidenav button", { hasText: "Train" }).first().click();
  await expect(page.locator("main")).not.toContainText("Loading…", { timeout: 10_000 });
  expect(errors).toEqual([]);
});
