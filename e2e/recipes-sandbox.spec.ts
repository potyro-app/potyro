import { test, expect } from "./console-guard";

// M1 DoD, sandbox path: the SAME recipes app loaded UNTRUSTED in the QuickJS-WASM isolate with
// mediated caps. If the list renders with computed macros, the isolate successfully ran the app's
// functions (computed + display) behind the marshalling boundary.

test("recipes app runs untrusted in the QuickJS-WASM isolate", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1")).toHaveText("Recipes");

  // Provenance badge proves this is the isolate path, not direct execution.
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");

  // The app's gallery + computed functions executed inside the isolate and marshalled results out.
  const rows = page.locator(".k-card");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(page.locator(".k-secondary").filter({ hasText: "kcal" }).first()).toBeVisible();

  // Detail navigation works through the isolate boundary too.
  await rows.first().click();
  await expect(page.locator("article.k-detail")).toBeVisible();

  // Cook mode, sealed: the screen held on and a step's timer kept by the shell, asked for across the
  // realm's port (docs/04 §Timers) — and let go of when cook mode closes.
  await page.getByRole("button", { name: /Start cooking/ }).click();
  await expect(page.locator("#cook-heading")).toContainText("Cooking:", { timeout: 30_000 });
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-k-awake", "");
  await page.locator(".ck-timer").click();
  const chip = page.locator(".k-timer-chip", { hasText: ", step 1" });
  await expect(chip).toHaveCount(1);
  await expect(page.locator(".ck-timer")).toHaveAttribute("data-running", "true");
  await page.getByRole("button", { name: /Recipes/ }).first().click();
  await expect(html).not.toHaveAttribute("data-k-awake", "");
  await chip.getByRole("button", { name: "Stop timer" }).click();
  await expect(chip).toHaveCount(0);
});
