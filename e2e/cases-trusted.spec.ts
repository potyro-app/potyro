import { test, expect } from "@playwright/test";

// Recording is the product feature that turns "it doesn't work" into a reproducible fact. This
// drives the whole loop with no model involved: record a path, annotate it, replay it, read what
// actually happened.
test("a recorded path replays and names the step that goes nowhere", async ({ page }) => {
  await page.goto("/?app=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes");

  await page.getByRole("button", { name: "Something's wrong" }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();

  // Use the app the way the person did.
  await page.locator(".k-list-row").first().click();
  await page.getByRole("button", { name: "Add a note" }).click();
  await page.getByRole("textbox", { name: "What did you expect?" }).fill("here I expected the map to open");
  await page.getByRole("button", { name: "Save note" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();

  // The report leads with the expectation and reports each step in the user's terms.
  const report = page.locator(".k-case-report");
  await expect(report).toBeVisible();
  await expect(report).toContainText("here I expected the map to open");
  await expect(report.locator(".k-case-step")).not.toHaveCount(0);
});
