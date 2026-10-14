import { test, expect, type Page } from "@playwright/test";
import { chosenFilter } from "./filters.js";

// M1 DoD, trusted path: browse recipes, open the custom cook-along view and tick a step, see
// computed macros, add a recipe, exercise the "ingredients I have" JS filter, and confirm the new
// recipe survives a reload (durable store — SqliteStore/OPFS, or the LocalStore fallback).

async function openRecipes(page: Page): Promise<void> {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1")).toHaveText("Recipes");
}

test("recipes app runs the full M1 flow in the browser (trusted)", async ({ page }) => {
  await openRecipes(page);

  // Provenance: the user's own app runs directly (trusted), not in the isolate.
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted");

  // List renders with rows, and the secondary line shows a COMPUTED macro ("… kcal · …").
  const rows = page.locator(".k-list-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(page.locator(".k-secondary").filter({ hasText: "kcal" }).first()).toBeVisible();

  // Open a recipe detail, then launch the custom cook-along view via its "Cook" action.
  await rows.first().click();
  await expect(page.locator("article.k-detail")).toBeVisible();
  await page.getByRole("button", { name: "Cook", exact: true }).click();

  // Custom view (full React component) — tick the first step's checkbox.
  await expect(page.locator("#cook-heading")).toContainText("Cooking:");
  const firstStep = page.locator("ol li input[type=checkbox]").first();
  await firstStep.check();
  await expect(firstStep).toBeChecked();

  // Add a recipe through the generated form and confirm it appears in the list.
  await page.getByRole("button", { name: /Recipes/ }).click(); // back to the list tab
  const unique = `E2E Test Dish ${Date.now()}`;
  await page.locator(".k-quickbar").getByRole("button", { name: /Add: Recipe/ }).click();
  const modal = page.locator(".k-modal");
  await expect(modal).toBeVisible();
  await modal.getByRole("textbox").first().fill(unique);
  await modal.getByRole("button", { name: "Create" }).click();
  // Quick-create opens the new record (create-and-open); return to the list to see it.
  await page.getByRole("button", { name: /Recipes/ }).click();
  await expect(page.locator(".k-list-row", { hasText: unique })).toBeVisible();

  // Durability: the added recipe survives a full reload (persisted store).
  await page.reload();
  await expect(page.locator(".k-list-row", { hasText: unique })).toBeVisible();

  // "Ingredients I have" JS predicate filter: the pantry chrome + chips drive an app filter fn.
  // The options sit behind one Filter button now rather than a row of chips across the page, so the
  // pantry is reached through the sheet — the chips themselves, and what picking one does, are the
  // same claim as before.
  await page.getByRole("button", { name: "What can I cook?" }).click();
  await page.getByRole("button", { name: /Filter/ }).first().click();
  const sheet = page.locator(".k-filter-sheet");
  await expect(sheet.getByText("In my pantry:")).toBeVisible();
  const chips = sheet.locator(".k-chip");
  // Waited for, not counted on the spot: the pantry chips are built from records, and a store that
  // answers asynchronously (SQLite in a worker) has them a moment after the sheet is on screen.
  await expect(chips.first()).toBeVisible();
  const ingredient = ((await chips.first().textContent()) ?? "").trim();
  await chips.first().click();
  await expect(sheet.locator(".k-chip[data-on='true']").first()).toBeVisible(); // filter state applied
  // …and it is still applied once the sheet is out of the way: the page keeps the chosen ingredient
  // as a chip beside the Filter button, which is how you can tell the list you are looking at is
  // narrowed rather than empty.
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(chosenFilter(page, ingredient)).toBeVisible();
});

test("edits an existing record in place from the list (universal edit)", async ({ page }) => {
  await openRecipes(page);
  const firstRow = page.locator(".k-list-row").first();
  await expect(firstRow).toBeVisible();

  // Edit lives on the record's page (#111): the row opens it, and Edit is behind "More actions"
  // there, next to Delete — never inline on every row.
  await firstRow.locator(".k-list-text").click();
  await expect(page.locator("article.k-detail")).toBeVisible();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const modal = page.locator(".k-modal");
  await expect(modal).toBeVisible();

  // It's an EDIT form: the name is prefilled and the button says "Save changes", not "Create".
  const nameInput = modal.getByRole("textbox").first();
  expect((await nameInput.inputValue()).length).toBeGreaterThan(0);
  await nameInput.fill("Edited Dish E2E");
  await modal.getByRole("button", { name: "Save changes" }).click();

  await expect(modal).toBeHidden();
  await page.getByRole("button", { name: /Recipes/ }).first().click(); // back to the list
  await expect(page.locator(".k-list-row", { hasText: "Edited Dish E2E" })).toBeVisible();
});

test("captures responsive screenshots of the recipes list", async ({ page }) => {
  await openRecipes(page);
  await expect(page.locator(".k-list-row").first()).toBeVisible();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `test-results/recipes-${width}.png`, fullPage: true });
  }
});

test("a table wider than the phone scrolls itself, and the page does not", async ({ page }) => {
  // "Why on the app recipe when I click high protein the bottom menu disappear": the table's columns
  // made the PAGE wider than the screen, so the whole app slid sideways — the header off the top,
  // and with it, on Firefox for Android, the bottom bar. A table is the one thing an app can declare
  // that is wider than a phone; it has to scroll inside itself.
  await page.setViewportSize({ width: 390, height: 780 });
  await openRecipes(page);
  await page.getByRole("button", { name: /High protein/ }).first().click();
  await expect(page.locator(".k-table")).toBeVisible();

  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    table: (() => {
      const el = document.querySelector(".k-table-scroll");
      return el ? el.scrollWidth - el.clientWidth : 0;
    })(),
  }));
  // The page fits. The table does not, which is exactly why it has its own scroll.
  expect(overflow.page).toBe(0);
  expect(overflow.table).toBeGreaterThan(0);

  // And the bottom bar is where it belongs, at the bottom of the screen.
  const bar = page.locator("nav").first();
  const box = (await bar.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(780);
  expect(box.x).toBe(0);

  // The columns are named, not keyed: "Calories per serving" (its label, #310), not "caloriesPerServing" — which is
  // also a twenty-character word that cannot wrap, and half of why this was ever too wide.
  await expect(page.locator(".k-table th").nth(2)).toHaveText("Calories per serving");
});
