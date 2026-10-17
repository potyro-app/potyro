import { test, expect, type Page } from "./console-guard";

/** Milk is in the basket: the folded section holds it, ticked. */
async function expectMilkInBasket(page: Page): Promise<void> {
  const basket = page.locator(".k-check-done");
  await expect(basket.locator("summary")).toHaveText("In the basket (3)", { timeout: 30_000 });
  if (!(await basket.evaluate((d: HTMLDetailsElement) => d.open))) await basket.locator("summary").click();
  await expect(basket.getByRole("checkbox", { name: "Milk" })).toHaveAttribute("aria-checked", "true");
}

// Opening an app, going home and opening it again — without a reload — must find the same records.
//
// It did not. Closing the app's store closed its database in the storage worker, but the connection
// stayed cached under the database's name; the second open was handed that closed connection, failed
// with "the database … is not open", and fell back to `localStorage` — which held none of the real
// records. Nothing said so: the app simply showed the seed, as if every change had been lost.

test("an edit is still there after going home and opening the app again in place", async ({ page }) => {
  const fellBack: string[] = [];
  page.on("console", (m) => {
    if (/falling back|Using local storage/.test(m.text())) fellBack.push(m.text());
  });

  await page.goto("/");
  const tile = page.getByRole("button", { name: "Groceries", exact: true });
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await tile.click();
  const milk = page.getByRole("checkbox", { name: "Milk" });
  await expect(milk).toBeVisible({ timeout: 30_000 });
  await milk.click();
  // Ticked, it folds into the basket.
  await expect(page.locator(".k-check-done summary")).toHaveText("In the basket (3)");

  await page.goBack(); // home, in place
  await expect(tile).toBeVisible({ timeout: 30_000 });
  await tile.click(); // the same app, in place

  await expectMilkInBasket(page);
  expect(fellBack).toEqual([]);
});
