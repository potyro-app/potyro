import { test, expect } from "./console-guard";
import { currentCard, openNewStudio, openSource } from "./studio-helpers.js";

// Two things found while using the Studio on a running app (2026-09-13), and how they hold now that
// the app opens as a screen of its own (#261).
//
// 1. The app under the Studio runs the module it booted with. Save a change in the Studio, close
//    it, and you were looking at the OLD version of the app you had just changed, until a reload.
// 2. A form sheet opened from the app in the Studio opened behind it, then over the whole Studio.
//    It belongs to the app's own screen: on top of the app, and inside it.

test.use({ viewport: { width: 1440, height: 900 } });

test("closing the Studio after a save shows the app as it now is", async ({ page }) => {
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();

  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-name")).toHaveText("Groceries", { timeout: 60_000 });

  // Rename the app in its source, run it, and save.
  const tools = await openSource(page, studio);
  const source = tools.getByRole("textbox", { name: "App source" });
  const before = await source.inputValue();
  // Groceries is in six languages (#302, #303): its name is a map, renamed in English here.
  const name = 'name: { en: "Groceries", "pt-BR": "Compras", de: "Einkäufe", es: "Compras", pl: "Zakupy", it: "Spesa" }';
  expect(before).toContain(name);
  await source.fill(before.replace(name, name.replace('en: "Groceries"', 'en: "Shopping"')));
  await tools.getByRole("button", { name: "Save changes" }).click();
  await expect(studio.locator(".k-studio-preview h1").first()).toHaveText("Shopping", { timeout: 60_000 });
  // Never renamed by hand, so it is called what its source now says.
  await expect(studio.locator(".k-studio-name")).toHaveText("Shopping", { timeout: 30_000 });
  await tools.getByRole("button", { name: "Close code, files and history" }).click();

  // Close: the app behind the Studio is the saved one, not the one it booted with.
  await studio.getByRole("button", { name: "Close studio" }).click();
  await expect(studio).toHaveCount(0);
  await expect(page.locator("h1").first()).toHaveText("Shopping", { timeout: 30_000 });
});

test("a form opened from the app in the Studio stays on the app's screen, on top of the app", async ({ page }) => {
  const studio = await openNewStudio(page);
  // The starter, written by hand — no model needed to have an app to open.
  const tools = await openSource(page, studio);
  await tools.getByRole("button", { name: "Save changes" }).click();
  await expect(currentCard(studio)).toBeVisible({ timeout: 30_000 });
  await tools.getByRole("button", { name: "Close code, files and history" }).click();

  const screen = studio.locator(".k-preview-screen");
  await expect(screen.locator("h1").first()).toHaveText("My App", { timeout: 60_000 });

  // The starter's own quick action, inside the app.
  await screen.getByRole("button", { name: /Add: Item/ }).first().click();
  const sheet = page.locator(".k-sheet").last();
  await expect(sheet).toBeVisible();
  // Inside the app's screen, not portalled over the whole page.
  await expect(screen.locator(".k-sheet")).toHaveCount(1);

  // Visible is not enough: the element actually at the middle of the sheet must be the sheet.
  const box = (await sheet.boundingBox())!;
  const onTop = await page.evaluate(
    ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest(".k-sheet")),
    [box.x + box.width / 2, box.y + Math.min(box.height / 2, 120)],
  );
  expect(onTop).toBe(true);
  // And it does not cover the conversation beside the app: the box to ask in is still the box.
  const composer = (await studio.getByRole("textbox", { name: "Describe the app" }).boundingBox())!;
  const reachable = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.getAttribute("aria-label") ?? null,
    [composer.x + composer.width / 2, composer.y + composer.height / 2],
  );
  expect(reachable).toBe("Describe the app");
});
