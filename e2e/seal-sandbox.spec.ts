import { test, expect } from "./console-guard";

// The "Feito com Potyro" seal (DESIGN.md §6, §8.1, #424): at the foot of every page of an app
// someone else made — here the examples run sealed, as a shared app does — a surface pill with
// the logo's symbol in the app's colour and the words, leading to potyro.com. The shell draws it,
// outside the app's code, so no prompt can take it off.

test("a sealed app wears the seal at the foot of its page, linking to Potyro", async ({ page }) => {
  await page.goto("/?app=groceries");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  const seal = page.locator(".k-seal");
  await expect(seal).toHaveCount(1);
  await expect(seal).toHaveText("Made with Potyro");
  await expect(seal).toHaveAttribute("href", /^https:\/\/potyro\.com\/?$/);
  // The symbol's stroke is a colour the logo sheet has — never the app's own angle repainted.
  const stroke = await seal.locator("svg path").nth(1).getAttribute("fill");
  expect(["#ec008c", "#ed1c24", "#f58337", "#ffcf5b", "#85ab8f", "#5085b6"]).toContain(stroke);
  // At the foot, after the content, not above it.
  const list = await page.locator(".k-checklist").first().boundingBox();
  await seal.scrollIntoViewIfNeeded();
  const box = await seal.boundingBox();
  expect(box!.y).toBeGreaterThan(list!.y);
});

// A sealed app's own screen fills the page down to the bottom bar. The seal's band used to come after
// it, so the page scrolled as well as the screen, pushing the app's top under the top bar (owner,
// Palette Catcher on a phone, 2026-10-25). The screen ends above a slim band instead.
test("on a phone a sealed app's own screen ends above the seal, and the page does not scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?app=workout");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  const view = page.locator(".k-sealed-view");
  const seal = page.locator(".k-seal-foot");
  await expect(view).toBeVisible({ timeout: 30_000 });
  await expect(seal).toBeVisible();
  const v = (await view.boundingBox())!;
  const s = (await seal.boundingBox())!;
  expect(Math.round(s.height)).toBe(48);
  expect(v.y + v.height).toBeLessThanOrEqual(s.y + 0.5);
  const overflow = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  expect(overflow).toBeLessThanOrEqual(1);
});
