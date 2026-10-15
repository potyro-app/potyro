import { test, expect } from "./console-guard";

// M1 DoD, sandbox path: the SAME recipes app loaded UNTRUSTED in the QuickJS-WASM isolate with
// mediated caps. If the list renders with computed macros, the isolate successfully ran the app's
// functions (computed + display) behind the marshalling boundary.

test("recipes app runs untrusted in the QuickJS-WASM isolate", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1")).toHaveText("Recipes");

  // Provenance badge proves this is the isolate path, not direct execution.
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  // The app's list + computed functions executed inside the isolate and marshalled results out.
  const rows = page.locator(".k-list-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(page.locator(".k-secondary").filter({ hasText: "kcal" }).first()).toBeVisible();

  // Detail navigation works through the isolate boundary too.
  await rows.first().click();
  await expect(page.locator("article.k-detail")).toBeVisible();
});
