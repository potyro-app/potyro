import { test, expect } from "@playwright/test";

// Two things found while using the Studio on a running app (2026-09-13).
//
// 1. The app under the Studio runs the module it booted with. Save a change in the Studio, close
//    it, and you were looking at the OLD version of the app you had just changed, until a reload.
// 2. A form sheet is portalled to <body> at a layer below the Studio's, so a form opened from the
//    Studio's own preview — "New Item" in the app you are building — opened invisibly behind it.

test.use({ viewport: { width: 1440, height: 900 } });

test("closing the Studio after a save shows the app as it now is", async ({ page }) => {
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();

  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-bar")).toContainText("· Groceries", { timeout: 60_000 });
  await expect(studio.locator(".k-studio-building")).toHaveCount(0, { timeout: 60_000 });

  // Rename the app in its source, run it, and save.
  await studio.getByRole("tab", { name: "Source" }).click();
  const source = studio.getByRole("textbox", { name: "App source" });
  const before = await source.inputValue();
  expect(before).toContain('name: "Groceries"');
  await source.fill(before.replace('name: "Groceries"', 'name: "Shopping"'));
  await studio.getByRole("button", { name: "Run ▶" }).click();
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("Shopping", { timeout: 60_000 });
  await studio.getByRole("button", { name: "Save changes" }).click();
  await expect(studio.locator(".k-studio-bar")).toContainText("· Shopping", { timeout: 30_000 });

  // Close: the app behind the Studio is the saved one, not the one it booted with.
  await studio.getByRole("button", { name: "Close studio" }).click();
  await expect(studio).toHaveCount(0);
  await expect(page.locator("h1").first()).toHaveText("Shopping", { timeout: 30_000 });
});

test("a form opened from the Studio's preview is on top of the Studio, not behind it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New app/ }).click();
  const studio = page.locator(".k-studio");
  const preview = studio.locator(".k-studio-preview");
  await expect(preview.locator("h1")).toHaveText("My App", { timeout: 60_000 });

  // The starter's own quick action, inside the preview.
  await preview.getByRole("button", { name: /New Item/ }).first().click();
  const sheet = page.locator(".k-sheet").last();
  await expect(sheet).toBeVisible();

  // Visible is not enough: the element actually at the middle of the sheet must be the sheet.
  const box = (await sheet.boundingBox())!;
  const onTop = await page.evaluate(
    ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest(".k-sheet")),
    [box.x + box.width / 2, box.y + Math.min(box.height / 2, 120)],
  );
  expect(onTop).toBe(true);
});
