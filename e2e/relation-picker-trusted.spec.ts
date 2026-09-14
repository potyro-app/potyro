import { test, expect, type Page } from "@playwright/test";

// A field pointing at other records is a searchable picker, not a browser <select> — the last raw
// browser control in a form. Recipes' ingredient rows each point at an ingredient.

async function openRecipeForm(page: Page): Promise<void> {
  await page.goto("/?user=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
  await page.locator(".k-list-row .k-list-text").first().click();
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.locator(".k-form")).toBeVisible();
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the recipe form has no <select>, and an ingredient is picked by searching", async ({ page }) => {
    await openRecipeForm(page);
    const form = page.locator(".k-form");
    await expect(form.locator("select")).toHaveCount(0);

    const row = form.locator(".k-row-card").first();
    const trigger = row.getByRole("button", { name: /^Ingredient: / });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const list = page.getByRole("listbox", { name: "Ingredient" });
    await expect(list).toBeVisible();
    await page.getByRole("searchbox", { name: "Search Ingredient" }).fill("egg");
    await expect(list.getByRole("option")).toHaveText(["Egg"]);
    await list.getByRole("option", { name: "Egg" }).click();
    await expect(list).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Ingredient: Egg" })).toBeVisible();
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the ingredient picker is a bottom sheet", async ({ page }) => {
    await openRecipeForm(page);
    const row = page.locator(".k-form .k-row-card").first();
    await row.getByRole("button", { name: /^Ingredient: / }).tap();
    const sheet = page.getByRole("dialog", { name: "Ingredient" });
    await expect(sheet).toHaveClass(/k-enum-list-sheet/);
  });
});
