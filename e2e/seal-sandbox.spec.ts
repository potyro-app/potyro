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
