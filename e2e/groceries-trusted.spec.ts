import { test, expect } from "@playwright/test";

// The checklist view (#106) in the Groceries example: tick an item with a finger and it is bought
// and moves to Done; type an item and press Enter and it is on the list with the input still
// focused for the next one; the ticked ones fold away.

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("ticking an item patches the record and moves it to Done; quick add keeps the focus", async ({ page }) => {
    await page.goto("/?user=groceries");
    await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });

    const list = page.locator(".k-checklist");
    await expect(list.locator(".k-check-heading").first()).toHaveText("bakery");
    const milk = list.getByRole("checkbox", { name: "Milk" });
    await expect(milk).toHaveAttribute("aria-checked", "false");
    const box = (await milk.boundingBox())!;
    expect(Math.round(Math.min(box.width, box.height))).toBeGreaterThanOrEqual(44);

    // The Done section starts folded with the two seeded bought items.
    const done = list.locator("details.k-check-done");
    await expect(done.locator("summary")).toHaveText("Done (2)");
    await expect(done).not.toHaveAttribute("open", "");

    await milk.tap();
    await expect(milk).toHaveAttribute("aria-checked", "true");
    // Struck through where it was for a beat, then under Done.
    await expect(milk.locator("xpath=ancestor::li")).toHaveAttribute("data-done", "true");
    await expect(done.locator("summary")).toHaveText("Done (3)");
    // Inside the folded section (a closed <details> hides its rows from the accessibility tree
    // until opened).
    await expect(done.locator(".k-check-row", { hasText: "Milk" })).toHaveCount(1);
    await done.locator("summary").tap();
    await expect(done.getByRole("checkbox", { name: "Milk" })).toBeVisible();
    // Persisted: it is bought after a reload.
    await page.reload();
    await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
    await page.locator("details.k-check-done summary").tap();
    await expect(page.getByRole("checkbox", { name: "Milk" })).toHaveAttribute("aria-checked", "true");

    // Quick add: type, Enter, next.
    const input = page.getByRole("textbox", { name: "Add an item" });
    await input.tap();
    await input.fill("Coffee");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("checkbox", { name: "Coffee" })).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    // Under the default aisle, as a real record.
    await expect(page.getByRole("checkbox", { name: "Coffee" }).locator("xpath=ancestor::section")).toHaveAttribute("aria-label", "pantry");
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the row's chevron opens the item, and un-ticking brings it back", async ({ page }) => {
    await page.goto("/?user=groceries");
    await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
    await page.getByRole("button", { name: "Open Apples" }).click();
    await expect(page.locator("article.k-detail")).toBeVisible();
    await expect(page.locator("article.k-detail")).toContainText("Apples");
    await page.getByRole("button", { name: "Shopping" }).click();
    await page.locator("details.k-check-done summary").click();
    const rice = page.getByRole("checkbox", { name: "Rice" });
    await expect(rice).toHaveAttribute("aria-checked", "true");
    await rice.click();
    await expect(rice).toHaveAttribute("aria-checked", "false");
    await expect(rice.locator("xpath=ancestor::section")).toHaveAttribute("aria-label", "pantry");
  });
});
