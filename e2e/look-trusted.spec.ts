import { test, expect, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";

// Choosing how this device looks, and what the colour you gave an app is actually for (#224).
//
// Reported: "The edit APP Tile when a color is selected it is not used anywhere, at least not in
// dark mode. Also we need to add themes, where the user can select the colors or choose to follow
// dark mode."
//
// Both halves of that were true. The tile's colour reached the tile and stopped — the app it opens
// never wore it — and the tint it did draw was mixed at a strength tuned on paper, which on a dark
// ground is mud. And nothing anywhere set `data-theme`, though the palette had been built around it
// from the beginning.

const openHome = async (page: Page): Promise<void> => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Look — appearance/ })).toBeVisible({ timeout: 30_000 });
};

const openLook = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: /Look — appearance/ }).click();
  await expect(page.getByRole("dialog", { name: "Look" })).toBeVisible();
};

const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

test("dark and light are a choice, and System hands it back", async ({ page }) => {
  await openHome(page);
  expect(await theme(page)).toBeNull(); // nothing chosen: the system decides

  await openLook(page);
  await page.getByRole("radio", { name: "Dark" }).click();
  expect(await theme(page)).toBe("dark");

  // It survives a reload — this is the device's look, not this page's.
  await page.reload();
  await expect(page.getByRole("button", { name: /Look — appearance/ })).toBeVisible({ timeout: 30_000 });
  expect(await theme(page)).toBe("dark");

  await openLook(page);
  await page.getByRole("radio", { name: "Light" }).click();
  expect(await theme(page)).toBe("light");

  // Back to System: removed, not pinned to light. A device that switches itself at sunset must
  // still switch.
  await page.getByRole("radio", { name: "System" }).click();
  expect(await theme(page)).toBeNull();
});

test("an accent chosen here is what the shell wears", async ({ page }) => {
  await openHome(page);
  await openLook(page);

  await page.getByRole("radio", { name: "Accent hue 205" }).click();
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--accent"))).toBe("oklch(72% 0.13 205)");

  await page.reload();
  await expect(page.getByRole("button", { name: /Look — appearance/ })).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--accent"))).toBe("oklch(72% 0.13 205)");
});

test("the colour you give an app is the colour the app wears", async ({ page }) => {
  // The reported bug: picked in Edit tile, and then visible nowhere that mattered.
  await openHome(page);
  await tileAction(page, "Recipes", "edit-tile");
  const editor = page.getByRole("dialog", { name: /Edit tile/ });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Hue 205" }).click();
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toHaveCount(0);

  await page.goto("/?user=recipes");
  await expect(page.locator("h1").first()).toHaveText("Recipes", { timeout: 30_000 });

  // The app's own accent token — what its buttons, tabs and focus rings are drawn from.
  const accent = await page.locator(".k-app").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--accent").trim());
  expect(accent).toBe("oklch(72% 0.13 205)");
});
