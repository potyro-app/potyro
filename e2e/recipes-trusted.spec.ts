import { test, expect, type Page } from "./console-guard";
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

  // The cookbook is a gallery of photo cards, and the secondary line shows a COMPUTED macro.
  const cards = page.locator(".k-card");
  await expect(cards.first()).toBeVisible();
  await expect(page.locator(".k-card .k-secondary").filter({ hasText: "kcal" }).first()).toBeVisible();

  // Open a recipe, then launch the custom cook view from the page's one big button.
  await cards.first().click();
  await expect(page.locator("article.k-detail")).toBeVisible();
  await page.getByRole("button", { name: /Start cooking/ }).click();

  // Custom view (full React component): one step at a time, and every step's tick underneath.
  await expect(page.locator("#cook-heading")).toContainText("Cooking:");
  await expect(page.getByText(/Step 1 of \d+/).first()).toBeVisible();
  // Cook mode holds the screen on (`ctx.ui.keepAwake`), and a step's timer is the shell's: its chip.
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-k-awake", "");
  const stepTimer = page.locator(".ck-timer");
  await stepTimer.click();
  await expect(stepTimer).toHaveAttribute("data-running", "true");
  await expect(stepTimer).toContainText(/\d+:\d\d · stop/);
  // The step draws its own countdown (`ctx.ui.drawsTimer`): its chip is not shown under it too.
  const chip = page.locator(".k-timer-chip", { hasText: ", step 1" });
  await expect(page.locator(".k-timer-chip")).toHaveCount(0);
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.getByText(/Step 2 of \d+/).first()).toBeVisible();
  // Step 2 has a timer of its own, not running; step 1's keeps counting — on its chip, now that
  // nothing else on screen shows it.
  await expect(stepTimer).toHaveAttribute("data-running", "false");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveCount(1);
  const firstStep = page.locator("ol li input[type=checkbox]").first();
  await expect(firstStep).toBeChecked(); // "Next step" ticked the step it left
  const secondStep = page.locator("ol li input[type=checkbox]").nth(1);
  await secondStep.check();
  await expect(secondStep).toBeChecked();

  // Add a recipe from the cookbook's own button — "Type it in" — and confirm it appears there.
  await page.getByRole("button", { name: /Recipes/ }).first().click(); // back to the cookbook tab
  // Out of cook mode the screen may sleep, and the step's timer is still in sight; stop it there.
  await expect(html).not.toHaveAttribute("data-k-awake", "");
  await expect(chip).toBeVisible();
  await chip.getByRole("button", { name: "Stop timer" }).click();
  await expect(chip).toHaveCount(0);
  const unique = `E2E Test Dish ${Date.now()}`;
  await page.getByRole("button", { name: /Add a recipe/ }).first().click();
  await page.getByRole("menuitem", { name: /Type it in/ }).click();
  const form = page.getByRole("dialog", { name: "New recipe" });
  await expect(form).toBeVisible();
  await form.getByRole("textbox").first().fill(unique);
  await form.getByRole("button", { name: "Add recipe" }).click();
  // It opens the new recipe; return to the cookbook to see it.
  await expect(page.locator("article.k-detail")).toContainText(unique);
  await page.getByRole("button", { name: /Recipes/ }).first().click();
  await expect(page.locator(".k-card", { hasText: unique })).toBeVisible();

  // Durability: the added recipe survives a full reload (persisted store).
  await page.reload();
  await expect(page.locator(".k-card", { hasText: unique })).toBeVisible();

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
  const firstRow = page.locator(".k-card").first();
  await expect(firstRow).toBeVisible();

  // Edit lives on the record's page (#111): the row opens it, and Edit is behind "More actions"
  // there, next to Delete — never inline on every row.
  await firstRow.click();
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
  await expect(page.locator(".k-card", { hasText: "Edited Dish E2E" })).toBeVisible();
});

test("captures responsive screenshots of the recipes list", async ({ page }) => {
  await openRecipes(page);
  await expect(page.locator(".k-card").first()).toBeVisible();
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
  // Four pages fit the phone's bar; High protein is behind More.
  await page.locator(".k-tabbar").getByRole("button", { name: "More pages" }).click();
  await page.getByRole("menuitem", { name: /High protein/ }).click();
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
