import { test, expect, type Page } from "./console-guard";

// Choosing one of a set (#98). Recipes' "Diet" has three options, so the form shows all three as a
// row of buttons. Places' "Kind" has six, so it opens a searchable list — a popover on a wide
// screen, a bottom sheet on a phone. Neither is a browser `<select>`, which was the last unstyled
// control in the form. A chosen value wears the same tint in the form and on the record page.

async function openApp(page: Page, app: string, title: string): Promise<void> {
  await page.goto(`/?user=${app}`);
  await expect(page.locator("h1").first()).toHaveText(title, { timeout: 30_000 });
}

/**
 * Places lands on the Map, and a map page adds inline — you arm placement and tap, which puts the
 * new record where you pointed — so the shell drops the floating quick action on that page rather
 * than offering two buttons for one act. These tests are about the form's enum control, not about
 * where the form was opened from, so they go to the list page, where adding is still a button.
 */
async function goToAllPlaces(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "All places" }).or(page.getByRole("button", { name: "All places" })).first().click();
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("three options are a row of buttons; the colour follows the value everywhere", async ({ page }) => {
    await openApp(page, "recipes", "Recipes");
    await page.getByRole("button", { name: /Add: Ingredient/ }).click();
    const form = page.locator(".k-form");
    await expect(form).toBeVisible();
    // Not a select — the whole form has none.
    await expect(form.locator("select")).toHaveCount(0);

    const diet = form.getByRole("radiogroup", { name: "Diet" });
    await expect(diet.getByRole("radio")).toHaveText(["vegan", "vegetarian", "animal-based"]);
    // Nothing is chosen for you.
    await expect(diet.locator("[aria-checked='true']")).toHaveCount(0);
    const vegan = diet.getByRole("radio", { name: "vegan" });
    await vegan.click();
    await expect(vegan).toHaveAttribute("aria-checked", "true");
    const formTint = await vegan.getAttribute("style");
    expect(formTint).toContain("--swatch");

    await form.getByRole("textbox", { name: "Name" }).fill("E2E Tofu");
    await form.getByRole("button", { name: "Create" }).click();

    // The record page shows the value as a pill in the same colour.
    const pill = page.locator("article.k-detail .k-enum-pill", { hasText: "vegan" });
    await expect(pill).toBeVisible();
    expect(await pill.getAttribute("style")).toBe(formTint);

    // Back on the pantry — a list you tick — it is there to tick.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("checkbox", { name: "E2E Tofu" })).toBeVisible();
  });

  test("many options open a searchable list in a popover", async ({ page }) => {
    await openApp(page, "places", "Places");
    await goToAllPlaces(page);
    await page.getByRole("button", { name: /Add: Place/ }).click();
    const form = page.locator(".k-form");
    await expect(form.locator("select")).toHaveCount(0);

    await form.getByRole("button", { name: "Kind: choose" }).click();
    const list = page.getByRole("listbox", { name: "Kind" });
    await expect(list.getByRole("option")).toHaveCount(11);
    await expect(page.getByRole("dialog", { name: "Kind" })).not.toHaveClass(/k-enum-list-sheet/);
    await page.getByRole("searchbox", { name: "Search Kind" }).fill("ba");
    await expect(list.getByRole("option")).toHaveText([/bar/, /bakery/]);
    await list.getByRole("option", { name: /bakery/ }).click();
    await expect(page.getByRole("dialog", { name: "Kind" })).toHaveCount(0);
    await expect(form.getByRole("button", { name: "Kind: bakery" })).toBeVisible();
  });

  test("a tags field with no options takes a typed tag", async ({ page }) => {
    await openApp(page, "plants", "Plants");
    await page.getByRole("button", { name: "Add: Plant" }).click();
    const form = page.locator(".k-form");
    const tags = form.locator(".k-tags input");
    await expect(tags).toHaveAttribute("placeholder", "Type a tag, press Enter");
    await tags.fill("weeknight");
    await tags.press("Enter");
    const chip = form.locator(".k-tag", { hasText: "weeknight" });
    await expect(chip).toBeVisible();
    await expect(tags).toHaveValue("");
    await chip.getByRole("button", { name: "Remove weeknight" }).click();
    await expect(form.locator(".k-tag")).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the long list is a bottom sheet", async ({ page }) => {
    await openApp(page, "places", "Places");
    await goToAllPlaces(page);
    await page.getByRole("button", { name: /Add: Place/ }).tap();
    const form = page.locator(".k-form");
    await form.getByRole("button", { name: "Kind: choose" }).tap();
    const sheet = page.getByRole("dialog", { name: "Kind" });
    await expect(sheet).toHaveClass(/k-enum-list-sheet/);
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeLessThan(2);
    expect(Math.round(box.y + box.height)).toBeGreaterThan(800);
    await sheet.getByRole("option", { name: /cafe/ }).tap();
    await expect(form.getByRole("button", { name: "Kind: cafe" })).toBeVisible();
  });
});
