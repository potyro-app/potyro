import { test, expect } from "./console-guard";

// A record page draws its actions' icons the system's way (#425): an action that names a Lucide icon
// (`icon: "droplet"`) shows the icon, never the name as text — on its main button at the bottom and
// on the buttons in its bar. Found on potyro.app: Plants' "Water" read "droplet Water".

test.use({ viewport: { width: 390, height: 844 } });

test("a record's main button draws its action's icon, not the icon's name", async ({ page }) => {
  await page.goto("/?user=plants");
  await expect(page.locator("h1").first()).toHaveText("Plants", { timeout: 30_000 });
  await page.locator(".k-list-row").first().click();
  const cta = page.locator(".k-primary-bar .k-cta");
  await expect(cta).toBeVisible({ timeout: 15_000 });
  await expect(cta.locator(".k-cta-icon svg[data-icon] path")).toBeAttached();
  await expect(cta).toHaveText(/^\s*Water\s*$/);
  // Nowhere on the page is an icon's name printed as a word.
  await expect(page.locator(".k-detail")).not.toContainText(/\b(droplet|pencil|trash-2|hourglass|notebook-pen)\b/);
});
