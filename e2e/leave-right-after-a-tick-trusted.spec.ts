import { test, expect, type Page } from "./console-guard";

/** Milk is in the basket: the folded section holds it, ticked. */
async function expectMilkInBasket(page: Page): Promise<void> {
  const basket = page.locator(".k-check-done");
  await expect(basket.locator("summary")).toHaveText("In the basket (3)", { timeout: 30_000 });
  if (!(await basket.evaluate((d: HTMLDetailsElement) => d.open))) await basket.locator("summary").click();
  await expect(basket.getByRole("checkbox", { name: "Milk" })).toHaveAttribute("aria-checked", "true");
}

// A tick is kept even when you leave the app the moment you make it.
//
// Ticking an item and going straight back home — the ordinary way a shopping list is used — lost
// the tick: reopened, the item was unticked again. Waiting a second or two before leaving kept it,
// so the write was still on its way when the app was put away.

test("a tick made just before going home is still there when the app is opened again", async ({ page }) => {
  await page.goto("/");
  const tile = page.getByRole("button", { name: "Groceries", exact: true });
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await tile.click();
  const milk = page.getByRole("checkbox", { name: "Milk" });
  await expect(milk).toHaveAttribute("aria-checked", "false", { timeout: 30_000 });

  await milk.click();
  // Ticked, it folds into the basket.
  await expect(page.locator(".k-check-done summary")).toHaveText("In the basket (3)");
  await page.goBack(); // straight home, in place — no pause

  await expect(tile).toBeVisible({ timeout: 30_000 });
  await tile.click();
  await expectMilkInBasket(page);

  // And across a full reload, which is how most people come back.
  await page.reload();
  await expectMilkInBasket(page);
});
