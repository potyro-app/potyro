import { test, expect } from "@playwright/test";

// The checklist view (#106) in the Groceries example, after a week of using it on a phone: a tick
// buys the item and SINKS it to the bottom of its own aisle — what is left to buy stays together —
// instead of moving it to a Done section at the end. The aisles are records now, so the seed walks
// the shop in order: Produce, Bakery, Dairy, Pantry, Household. Type an item and press Enter and it is on the list with the input still
// focused for the next one; the ticked ones fold away.

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("ticking an item patches the record and sinks it in its aisle; quick add keeps the focus", async ({ page }) => {
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
    await expect(dairy.locator(".k-check-label")).toHaveText(["Milk", "Yoghurt"]);

    await milk.tap();
    await expect(milk).toHaveAttribute("aria-checked", "true");
    // Struck through where it was for a beat, then LAST IN ITS OWN AISLE — never out of it.
    await expect(milk.locator("xpath=ancestor::li")).toHaveAttribute("data-done", "true");
    await expect(dairy.locator(".k-check-label")).toHaveText(["Yoghurt", "Milk"], { timeout: 10_000 });

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
});
