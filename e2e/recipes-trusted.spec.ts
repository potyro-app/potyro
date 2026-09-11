import { test, expect, type Page } from "@playwright/test";

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
  await expect(page.locator(".k-prov")).toHaveText(/^trusted/);

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
  await page.locator(".k-quickbar").getByRole("button", { name: /New Recipe/ }).click();
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
  await page.getByRole("button", { name: "What can I cook?" }).click();
  await expect(page.getByText("In my pantry:")).toBeVisible();
  const chips = page.locator(".k-chip");
  expect(await chips.count()).toBeGreaterThan(0);
  await chips.first().click();
  await expect(page.locator(".k-chip[data-on='true']").first()).toBeVisible(); // filter state applied
});

test("edits an existing record in place from the list (universal edit)", async ({ page }) => {
  await openRecipes(page);
  const firstRow = page.locator(".k-list-row").first();
  await expect(firstRow).toBeVisible();

  // Every list row is editable — click its inline Edit (previously impossible without a wired detail).
  await firstRow.getByRole("button", { name: "Edit" }).click();
  const modal = page.locator(".k-modal");
  await expect(modal).toBeVisible();

  // It's an EDIT form: the name is prefilled and the button says "Save changes", not "Create".
  const nameInput = modal.getByRole("textbox").first();
  expect((await nameInput.inputValue()).length).toBeGreaterThan(0);
  await nameInput.fill("Edited Dish E2E");
  await modal.getByRole("button", { name: "Save changes" }).click();

  await expect(modal).toBeHidden();
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
