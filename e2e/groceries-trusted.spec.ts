import { test, expect } from "./console-guard";

// The checklist view (#106) in the Groceries example, after a week of using it on a phone: a tick
// buys the item and SINKS it to the bottom of its own aisle — what is left to buy stays together —
// instead of moving it to a Done section at the end. The aisles are records now, so the seed walks
// the shop in order: Produce, Bakery, Dairy, Pantry, Frozen, Household. Type an item and press Enter
// and it is on the list with the input still focused for the next one. "Done shopping" puts what was
// ticked away into memory, and Usuals brings it back in one tap, in its aisle.

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("ticking an item patches the record and leaves it where it is; quick add keeps the focus", async ({ page }) => {
    await page.goto("/?user=groceries");
    await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });

    const list = page.locator(".k-checklist");
    // Aisles in walking order, not an enum in alphabetical order.
    await expect(list.locator(".k-check-heading").first()).toHaveText("Produce");
    const milk = list.getByRole("checkbox", { name: "Milk" });
    await expect(milk).toHaveAttribute("aria-checked", "false");
    const box = (await milk.boundingBox())!;
    expect(Math.round(Math.min(box.width, box.height))).toBeGreaterThanOrEqual(44);

    const dairy = page.locator("section", { has: page.getByRole("heading", { name: "Dairy" }) });
    await expect(dairy.locator(".k-check-label")).toHaveText(["Milk", "Yoghurt", "Eggs"]);

    await milk.tap();
    await expect(milk).toHaveAttribute("aria-checked", "true");
    // Struck through WHERE IT IS. It used to sink to the bottom of its aisle, which moved the line
    // under the finger that had just touched it; that is opt-in now (`donePlacement: "sink"`).
    await expect(milk.locator("xpath=ancestor::li")).toHaveAttribute("data-done", "true");
    await page.waitForTimeout(1_000);
    await expect(dairy.locator(".k-check-label")).toHaveText(["Milk", "Yoghurt", "Eggs"]);

    // Persisted: still bought after a reload.
    await page.reload();
    await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
    await expect(page.getByRole("checkbox", { name: "Milk" })).toHaveAttribute("aria-checked", "true");

    // Quick add: type, Enter, next.
    const input = page.getByRole("textbox", { name: "Add an item" });
    await input.tap();
    await input.fill("Coffee");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("checkbox", { name: "Coffee" })).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    // A new item has no aisle yet: the app ASKS which, rather than guessing one.
    await expect(page.locator(".k-check-hint")).toContainText("Coffee");
    await page.getByRole("button", { name: /Put Coffee in Pantry/ }).tap();
    await expect(page.getByRole("checkbox", { name: "Coffee" }).locator("xpath=ancestor::section")).toHaveAttribute(
      "aria-label",
      "Pantry",
    );
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the row's chevron opens the item, and un-ticking lifts it back up its aisle", async ({ page }) => {
    await page.goto("/?user=groceries");
    await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
    await page.getByRole("button", { name: "Open Apples" }).click();
    await expect(page.locator("article.k-detail")).toBeVisible();
    await expect(page.locator("article.k-detail")).toContainText("Apples");
    await page.getByRole("button", { name: "Back" }).first().click();
    // Rice is bought, so it sits at the bottom of Pantry — there is no Done section to unfold.
    const rice = page.getByRole("checkbox", { name: "Rice" });
    await expect(rice).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
    await rice.click();
    await expect(rice).toHaveAttribute("aria-checked", "false");
    await expect(rice.locator("xpath=ancestor::section")).toHaveAttribute("aria-label", "Pantry");
  });

  test("Done shopping puts the basket away, and Usuals brings a thing back to its aisle in one tap", async ({ page }) => {
    await page.goto("/?user=groceries");
    await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
    // Spinach and Rice are in the basket on a first run.
    await expect(page.getByRole("checkbox", { name: "Spinach" })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
    await page.getByRole("button", { name: /Done shopping/ }).first().click();
    await expect(page.locator(".k-toast")).toContainText("Put 2 things away");
    await expect(page.getByRole("checkbox", { name: "Spinach" })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Rice" })).toHaveCount(0);

    // Remembered: one more time bought, and one tap from the list.
    await page.locator(".k-sidenav .k-tab", { hasText: "Usuals" }).click();
    const spinach = page.locator(".k-list-row", { hasText: "Spinach" });
    await expect(spinach).toContainText("5 times, last today");
    await spinach.getByRole("button", { name: /Add/ }).click();
    await expect(page.locator(".k-toast").last()).toContainText("Spinach is on the list");
    await expect(spinach).toHaveCount(0);
    await page.locator(".k-sidenav .k-tab", { hasText: "List" }).click();
    const back = page.getByRole("checkbox", { name: "Spinach" });
    await expect(back).toHaveAttribute("aria-checked", "false");
    await expect(back.locator("xpath=ancestor::section")).toHaveAttribute("aria-label", "Produce");
  });
});
