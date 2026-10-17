import { test, expect } from "./console-guard";
import { settleFirstRow } from "./split-settle";

// Split sealed: its expense list's `group` is a function (the day), and in the sealed box a function
// reaches the views as a sentinel string — which once read as a field key, so every sealed list lost
// its headings. And a balance row's Settle hands its payment across the box to the app's action.

test("sealed, the expenses are under their days and a row's Settle records its payment", async ({ page }) => {
  await page.goto("/?user=split");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(page.locator(".k-fold-group .k-fold-head").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".k-fold-group", { hasText: "Fado night tickets" }).locator(".k-fold-head")).toHaveText(/\w{3}, \w{3} \d+/);
  await settleFirstRow(page);
});
