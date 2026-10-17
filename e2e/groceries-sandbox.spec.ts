import { test, expect } from "./console-guard";

// The checklist view renders UNTRUSTED (#106): the Groceries app runs sealed, its bindings, `when`
// and `usuals` cross to the host as values, and a tap still patches the record.

test("groceries runs sealed: the list, a tick folding into the basket, Done shopping, the usuals", async ({ page }) => {
  await page.goto("/?app=groceries");
  await expect(page.locator(".k-scope")).toContainText("Weekly shop", { timeout: 30_000 });
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  const list = page.locator(".k-checklist");
  // The aisles are RECORDS the sealed app relates to, resolved like any other relation — and in the
  // order the shop is walked.
  await expect(list.locator(".k-check-heading").first()).toHaveText("Produce");
  const dairy = page.locator("section", { has: page.getByRole("heading", { name: "Dairy" }) });
  await list.getByRole("checkbox", { name: "Milk" }).click();
  await expect(dairy.locator(".k-check-label")).toHaveText(["Yoghurt", "Eggs"]);
  await expect(page.locator(".k-check-done summary")).toHaveText("In the basket (3)");
  // The sealed app's `when` says the basket has something in it.
  await expect(page.locator(".k-primary-bar").getByRole("button", { name: /Done shopping/ })).toBeVisible();
  // And its `usuals` are offered by the empty box.
  await page.getByRole("textbox", { name: "Add an item" }).click();
  await expect(page.getByRole("list", { name: "Usual items" }).getByRole("button").first()).toHaveText("＋ Coffee beans");
});
