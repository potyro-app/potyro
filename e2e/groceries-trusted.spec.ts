import { test, expect, type Page } from "./console-guard";

// Groceries as it is used most: in a shop, phone in one hand. The list opens on its items — the first
// one right under the app bar, not under a header card — in the aisles' walking order. A tap anywhere
// on a row ticks it, and the ticked thing folds into "In the basket" so what is left stays on screen.
// "Done shopping" is a bar at the bottom that is only there once something is in the basket. The
// usuals are what the add box offers when you tap it. Several lists, switched from the title, where
// the shell also makes, renames, copies and deletes them.

const scope = (page: Page) => page.locator(".k-scope");

async function openList(page: Page): Promise<void> {
  await page.goto("/?user=groceries");
  await expect(scope(page)).toContainText("Weekly shop", { timeout: 30_000 });
  await expect(page.locator(".k-check-row").first()).toBeVisible();
}

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("the list is the first thing on screen; a tap on a row ticks it and it folds into the basket", async ({ page }) => {
    await openList(page);
    const list = page.locator(".k-checklist");
    // Content first: the first item sits right under the app bar and the one line of figures.
    const first = (await list.locator(".k-check-row").first().boundingBox())!;
    expect(first.y).toBeLessThan(220);
    await expect(page.locator(".k-page-figures .k-summary")).toContainText("11 to buy");
    await expect(page.locator(".k-page-figures .k-summary")).toContainText("2 in the basket");
    // Aisles in walking order.
    await expect(list.locator(".k-check-heading").first()).toHaveText("Produce");

    const dairy = page.locator("section", { has: page.getByRole("heading", { name: "Dairy" }) });
    await expect(dairy.locator(".k-check-label")).toHaveText(["Milk", "Yoghurt", "Eggs"]);
    // The whole row is the target, not only the circle.
    await dairy.locator(".k-check-row", { hasText: "Milk" }).locator(".k-check-label").tap();
    await expect(dairy.locator(".k-check-label")).toHaveText(["Yoghurt", "Eggs"]);
    const basket = page.locator(".k-check-done");
    await expect(basket.locator("summary")).toHaveText("In the basket (3)");
    await basket.locator("summary").tap();
    await expect(basket.getByRole("checkbox", { name: "Milk" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".k-page-figures .k-summary")).toContainText("3 in the basket");

    // Persisted: still bought after a reload.
    await page.reload();
    await expect(scope(page)).toContainText("Weekly shop", { timeout: 30_000 });
    await expect(page.locator(".k-check-done summary")).toHaveText("In the basket (3)");

    // Quick add: type, Enter, next — into the aisle the app knows it from.
    const input = page.getByRole("textbox", { name: "Add an item" });
    await input.tap();
    await input.fill("Coffee");
    await page.keyboard.press("Enter");
    const coffee = page.getByRole("checkbox", { name: "Coffee", exact: true });
    await expect(coffee).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(coffee.locator("xpath=ancestor::section")).toHaveAttribute("aria-label", "Pantry");
    // A name it does not know has no aisle yet: every aisle shows, and the app asks which.
    await input.fill("Birthday candles");
    await page.keyboard.press("Enter");
    await expect(page.locator(".k-check-hint")).toContainText("Birthday candles");
    await page.getByRole("button", { name: /Put Birthday candles in Household/ }).tap();
    await expect(page.getByRole("checkbox", { name: "Birthday candles" }).locator("xpath=ancestor::section")).toHaveAttribute("aria-label", "Household");
  });

  test("the empty add box offers the usuals; one tap puts one on the list, in its aisle", async ({ page }) => {
    await openList(page);
    const input = page.getByRole("textbox", { name: "Add an item" });
    await expect(page.getByRole("list", { name: "Usual items" })).toHaveCount(0);
    await input.tap();
    const usuals = page.getByRole("list", { name: "Usual items" });
    await expect(usuals.getByRole("button").first()).toHaveText("＋ Coffee beans");
    // What is on the list already is not offered.
    await expect(usuals.getByRole("button", { name: /Milk/ })).toHaveCount(0);
    await usuals.getByRole("button", { name: "＋ Lemons" }).tap();
    const lemons = page.getByRole("checkbox", { name: "Lemons", exact: true });
    await expect(lemons).toHaveAttribute("aria-checked", "false");
    await expect(lemons.locator("xpath=ancestor::section")).toHaveAttribute("aria-label", "Produce");
    await expect(usuals.getByRole("button", { name: "＋ Lemons" })).toHaveCount(0);
  });

  test("dragging and renaming wait behind Arrange", async ({ page }) => {
    await openList(page);
    await expect(page.locator(".k-check-grip")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Rename / })).toHaveCount(0);
    await page.getByRole("button", { name: "Arrange" }).tap();
    await expect(page.locator(".k-check-grip").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Rename Produce" })).toBeVisible();
    // Every aisle shows while arranging, the empty ones too, and a new one can be made.
    await expect(page.getByRole("button", { name: "+ Aisle" })).toBeVisible();
    await page.getByRole("button", { name: "Done arranging" }).tap();
    await expect(page.locator(".k-check-grip")).toHaveCount(0);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Done shopping is there only once something is in the basket, and puts it away", async ({ page }) => {
    await openList(page);
    const done = page.locator(".k-primary-bar").getByRole("button", { name: /Done shopping/ });
    await expect(done).toBeVisible();
    await done.click();
    await expect(page.locator(".k-toast")).toContainText("Put 2 things away");
    await expect(page.getByRole("checkbox", { name: "Spinach" })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Rice" })).toHaveCount(0);
    // Nothing in the basket: nothing to finish.
    await expect(page.locator(".k-primary-bar")).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Apples" }).click();
    await expect(page.locator(".k-primary-bar")).toBeVisible();
  });

  test("the row's chevron opens the item, and un-ticking brings it back to its aisle", async ({ page }) => {
    await openList(page);
    await page.getByRole("button", { name: "Open Apples" }).click();
    await expect(page.locator("article.k-detail")).toContainText("Apples");
    await page.getByRole("button", { name: "Back" }).first().click();
    await page.locator(".k-check-done summary").click();
    const rice = page.getByRole("checkbox", { name: "Rice" });
    await expect(rice).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
    await rice.click();
    await expect(rice).toHaveAttribute("aria-checked", "false");
    await expect(rice.locator("xpath=ancestor::section")).toHaveAttribute("aria-label", "Pantry");
  });

  test("lists: switch from the title, make one, copy one with its items, delete one", async ({ page }) => {
    await openList(page);
    const menu = page.getByRole("menu");
    await scope(page).click();
    await menu.getByRole("menuitem", { name: "Party" }).click();
    await expect(scope(page)).toContainText("Party");
    await expect(page.getByRole("checkbox", { name: "Limes" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Apples" })).toHaveCount(0);

    // A copy, with its items, under the name asked for.
    await scope(page).click();
    await menu.getByRole("menuitem", { name: "Duplicate…" }).click();
    const ask = page.getByRole("dialog");
    await ask.getByRole("textbox").fill("Next party");
    await ask.getByRole("button", { name: "OK" }).click();
    await expect(scope(page)).toContainText("Next party");
    await expect(page.getByRole("checkbox", { name: "Limes" })).toBeVisible();

    // A new one, from the form; it is the one shown, and empty.
    await scope(page).click();
    await menu.getByRole("menuitem", { name: "New List" }).click();
    const form = page.locator(".k-form");
    await form.getByLabel(/Name/).fill("Hardware store");
    await form.getByRole("button", { name: "Create" }).click();
    await expect(scope(page)).toContainText("Hardware store");
    await expect(page.locator(".k-check-row")).toHaveCount(0);

    // Deleted, asked first, with what is in it; another list is shown.
    await scope(page).click();
    await menu.getByRole("menuitem", { name: "Party" }).click();
    await scope(page).click();
    await menu.getByRole("menuitem", { name: "Delete…" }).click();
    await expect(page.getByRole("dialog")).toContainText("Delete “Party”?");
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(scope(page)).not.toContainText("Party", { timeout: 10_000 });
    await scope(page).click();
    await expect(menu.getByRole("menuitem", { name: "Party", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Next party" })).toBeVisible();
  });
});
