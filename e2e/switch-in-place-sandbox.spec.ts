import { test, expect } from "./console-guard";

// Switching in place with untrusted apps (#89): each switch puts the previous app's QuickJS isolate
// away and starts the next one, with no page load.

test("untrusted apps switch in place, each in its own fresh isolate", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  let loads = 0;
  // The app's own loads: Firefox also reports the new tab's about:blank, which Chromium does not.
  page.on("load", (p) => void (p.url().startsWith("about:") || (loads += 1)));
  await page.goto("/?app=recipes");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await page.getByRole("button", { name: "Switch app" }).click();
  await page.locator(".k-launcher-overlay .k-launch-tile", { hasText: "Plants" }).click();
  await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");
  await page.goBack();
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });
  await expect(page.locator(".k-card", { hasText: "Fluffy Pancakes" })).toBeVisible({ timeout: 30_000 });
  expect(loads).toBe(1);
});
