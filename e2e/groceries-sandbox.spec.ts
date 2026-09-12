import { test, expect } from "@playwright/test";

// The checklist view renders UNTRUSTED (#106): the Groceries app runs in the QuickJS-WASM isolate,
// its `sort` and bindings cross the bridge as values, and a tick still patches the record.

test("groceries checklist runs untrusted in the isolate: rows, headings, a tick", async ({ page }) => {
  await page.goto("/?app=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await expect(page.locator(".k-prov")).toHaveText(/^untrusted/);

  const list = page.locator(".k-checklist");
  await expect(list.locator(".k-check-heading").first()).toHaveText("bakery");
  const milk = list.getByRole("checkbox", { name: "Milk" });
  await expect(milk).toHaveAttribute("aria-checked", "false");
  await milk.click();
  await expect(milk).toHaveAttribute("aria-checked", "true");
  await expect(list.locator("details.k-check-done summary")).toHaveText("Done (3)");
});
