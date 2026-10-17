import { expect, type Page } from "@playwright/test";

/**
 * Show the app-wide selection named `name` (a list, a trip, a group): an app opens on its first one
 * by itself, so the switcher in the title is only used when that is not the one wanted.
 */
export async function pickScope(page: Page, name: RegExp, timeout = 30_000): Promise<void> {
  const scope = page.locator(".k-scope");
  await expect(scope).toBeVisible({ timeout });
  await expect(scope).not.toContainText("Choose…", { timeout });
  if (name.test(((await scope.locator(".k-scope-name").textContent()) ?? "").trim())) return;
  await scope.click();
  await page.getByRole("menu").getByRole("menuitem", { name }).first().click();
  await expect(scope.locator(".k-scope-name")).toHaveText(name);
}
