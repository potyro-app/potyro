import { test, expect } from "@playwright/test";

// The checklist view renders UNTRUSTED (#106): the Groceries app runs in the QuickJS-WASM isolate,
// its `sort` and bindings cross the bridge as values, and a tick still patches the record.

test("groceries checklist runs untrusted in the isolate: rows, headings, a tick", async ({ page }) => {
  await page.goto("/?app=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  const list = page.locator(".k-checklist");
  // The aisles are RECORDS the untrusted app relates to, resolved across the bridge like any
  // other relation — and in the order the shop is walked.
  await expect(list.locator(".k-check-heading").first()).toHaveText("Produce");
  const milk = list.getByRole("checkbox", { name: "Milk" });
  await expect(milk).toHaveAttribute("aria-checked", "false");
  await milk.click();
  await expect(milk).toHaveAttribute("aria-checked", "true");
  // It sinks to the bottom of its own aisle instead of leaving for a Done section.
  const dairy = page.locator("section", { has: page.getByRole("heading", { name: "Dairy" }) });
  await expect(dairy.locator(".k-check-label")).toHaveText(["Yoghurt", "Milk"], { timeout: 10_000 });
});
