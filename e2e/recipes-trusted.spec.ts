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

  // Choosing what to cook is the cookbook's own job: its search and chips drive the app's filter fn.
  const names = async () => (await page.locator(".k-card .k-primary").allTextContents()).map((t) => t.trim());
  const all = (await names()).length;
  await page.getByRole("searchbox", { name: "Search" }).fill("pancake");
  await expect.poll(names).toEqual(["Fluffy Pancakes"]);
  await page.getByRole("searchbox", { name: "Search" }).fill("");
  await expect.poll(async () => (await names()).length).toBe(all);
  // "Can cook now" keeps what the pantry covers.
  await page.getByRole("switch", { name: "Can cook now" }).click();
  await expect.poll(async () => (await names()).length).toBeLessThan(all);
  await page.getByRole("switch", { name: "Can cook now" }).click();
  // The meal is behind the one Filter button; what was chosen stays as a chip beside it.
  await page.getByRole("button", { name: /Filter/ }).first().click();
  const sheet = page.locator(".k-filter-sheet");
  await sheet.getByRole("button", { name: "breakfast" }).click();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(chosenFilter(page, "breakfast")).toBeVisible();
  await expect(page.locator(".k-card", { hasText: "Fluffy Pancakes" })).toBeVisible();
  await expect(page.locator(".k-card", { hasText: "Chickpea Curry" })).toHaveCount(0);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a recipe opens on its ingredients, over its photo, with Start cooking at the bottom", async ({ page }) => {
    await openRecipes(page);
    // The cookbook: nothing floating, and the first cards right under the search and its chips.
    await expect(page.locator(".k-topbar-add")).toHaveCount(0);
    expect((await page.locator(".k-card").first().boundingBox())!.y).toBeLessThan(260);
    // A card's name is under its photo, not on it.
    const card = page.locator(".k-card", { hasText: "Shakshuka" }).first();
    const photo = (await card.locator(".k-card-media").boundingBox())!;
    const name = (await card.locator(".k-primary").boundingBox())!;
    expect(name.y).toBeGreaterThanOrEqual(photo.y + photo.height - 1);

    await card.tap();
    const detail = page.locator("article.k-detail");
    await expect(detail).toHaveAttribute("data-cover", "background");
    // The ingredients are on the first screen, as lines: "20 ml Olive oil", not a table.
    const ingredients = detail.locator(".k-section", { has: page.getByRole("heading", { name: "Ingredients" }) });
    await expect(ingredients.locator(".k-row-lines li").first()).toHaveText(/^\d+ \S+ \S/);
    expect((await ingredients.boundingBox())!.y).toBeLessThan(500);
    await expect(ingredients.locator("table")).toHaveCount(0);
    // A step's time reads as minutes.
    await expect(detail.locator(".k-row-list li").first()).toContainText(/· \d+ min/);
    // Start cooking is the bar at the bottom; Plan it / Cooked it wait after the sections.
    const start = page.locator(".k-primary-bar").getByRole("button", { name: /Start cooking/ });
    await expect(start).toBeVisible();
    const actions = (await detail.locator(".k-detail-actions").boundingBox())!;
    const lastSection = (await detail.locator(".k-section").last().boundingBox())!;
    expect(actions.y).toBeGreaterThan(lastSection.y);
    await start.tap();
    await expect(page.locator("#cook-heading")).toContainText("Cooking:");
  });
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

// A table is the one thing an app can declare that is wider than a phone: an app of its own here, with
// more columns than fit, since no example keeps a wide table now.
const WIDE_TABLE_APP = `import { defineApp } from "potyro";
export default defineApp({
  id: "nutrition", name: "Nutrition", version: "1.0.0", schemaVersion: 1,
  entities: { food: { label: "Food", displayField: "name", fields: {
    name: { type: "text", required: true },
    caloriesPerServing: { type: "number", label: "Calories per serving" },
    proteinPerServing: { type: "number", label: "Protein per serving" },
    fatPerServing: { type: "number", label: "Fat per serving" },
    carbsPerServing: { type: "number", label: "Carbohydrates per serving" },
    servings: { type: "number", label: "Servings" },
  } } },
  pages: [
    { id: "table", title: "Table", view: { type: "table", entity: "food", display: { columns: ["name", "caloriesPerServing", "proteinPerServing", "fatPerServing", "carbsPerServing", "servings"] } } },
    { id: "other", title: "Other", view: { type: "list", entity: "food" } },
  ],
});
`;

test("a table wider than the phone scrolls itself, and the page does not", async ({ page }) => {
  // "Why on the app recipe when I click high protein the bottom menu disappear": the table's columns
  // made the PAGE wider than the screen, so the whole app slid sideways — the header off the top,
  // and with it, on Firefox for Android, the bottom bar. A table has to scroll inside itself.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.addInitScript((source) => {
    if (localStorage.getItem("potyro:user-apps")) return;
    localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "nutrition", name: "Nutrition", source, trusted: true, updatedAt: new Date(0).toISOString() }]));
  }, WIDE_TABLE_APP);
  await page.goto("/?user=nutrition");
  await expect(page.locator(".k-app")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async () => {
    const { openStore } = await import("/src/open-store.ts");
    const store = await openStore("user:nutrition");
    if (!(await store.all("food")).length) await store.insert("food", { name: "Shakshuka", caloriesPerServing: 321, proteinPerServing: 18, fatPerServing: 20, carbsPerServing: 14, servings: 2 });
  });
  await page.reload();
  await expect(page.locator(".k-table")).toBeVisible({ timeout: 30_000 });

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

  // The columns are named, not keyed: "Calories per serving" (its label, #310), not "caloriesPerServing".
  await expect(page.locator(".k-table th").nth(1)).toHaveText("Calories per serving");
});
