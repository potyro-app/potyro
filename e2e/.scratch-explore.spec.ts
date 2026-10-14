// SCRATCH (uncommitted): what each example shows in Polish, as text, to choose the assertions.
import { test } from "@playwright/test";

test.use({ locale: "pl-PL", viewport: { width: 375, height: 812 } });

for (const app of ["groceries", "plants", "places", "recipes", "split", "workout"]) {
  test(`explore ${app}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("potyro:sync:relay", "ws://localhost:4999"));
    await page.goto(`/?user=${app}`);
    await page.locator("h1").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    const text = await page.locator("body").innerText();
    console.log(`\n===== ${app}\n${text.slice(0, 900).replace(/\n+/g, " | ")}`);
  });
}
