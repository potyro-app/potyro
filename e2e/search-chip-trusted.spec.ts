import { test, expect } from "./console-guard";

// Searching inside an app (#216).
//
// `FilterChip` could only be a toggle, a "use my location" button, or a pick from a fixed list — so
// there was no way for an app to take a VALUE from the person at view time. No search box, and no
// "over £20" either. The generator's own corpus of realistic asks names both as things the runtime
// could not express ("free-text search across records", "filtering by a user-supplied threshold at
// view time"), and an app with three hundred rows and no way to find one is barely an app.
//
// The chip collects the text; the app's `filter` decides what matching means. Recipes searches its
// name and its tags.

test("typing in an app's search chip narrows the list, and clearing it brings everything back", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1")).toHaveText("Recipes");
  // The search is on "What can I cook?", beside the pantry and the other ways to narrow it.
  await page.getByRole("button", { name: "What can I cook?" }).first().click();

  const rows = page.locator(".k-list-row");
  const all = await rows.count();
  expect(all).toBeGreaterThan(1);

  const search = page.getByRole("searchbox", { name: "Search" });
  await expect(search).toBeVisible();

  // A name the app can match on. `pressSequentially`, not `fill`: the box holds its own text and
  // writes the param on a delay, and a programmatic value-set does not exercise that at all.
  await search.pressSequentially("pancake", { delay: 20 });
  await expect(search).toHaveValue("pancake");

  await expect.poll(() => rows.count(), { timeout: 10_000 }).toBeLessThan(all);
  await expect(rows.first()).toContainText(/pancake/i);

  // Something no recipe is called: the app says so rather than showing a list that ignored the box.
  await search.fill("");
  await search.pressSequentially("zzzz", { delay: 20 });
  await expect.poll(() => rows.count(), { timeout: 10_000 }).toBe(0);

  // Cleared with the button next to it — everything is back.
  await page.getByRole("button", { name: "Clear Search" }).click();
  await expect(search).toHaveValue("");
  await expect.poll(() => rows.count(), { timeout: 10_000 }).toBe(all);
});

test("the search box stays in the page's own row, not hidden inside the Filter sheet", async ({ page }) => {
  // A search box is the thing someone with a long list came to the page for. Behind a button called
  // "Filter" it may as well not exist.
  await page.goto("/?app=recipes");
  await expect(page.locator("h1")).toHaveText("Recipes");
  // The search is on "What can I cook?", beside the pantry and the other ways to narrow it.
  await page.getByRole("button", { name: "What can I cook?" }).first().click();

  const chrome = page.locator(".k-chrome");
  await expect(chrome.getByRole("searchbox", { name: "Search" })).toBeVisible();
});
