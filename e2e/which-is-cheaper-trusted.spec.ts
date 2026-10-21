import { test, expect } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";

// apps/which-is-cheaper, packed as its build packs it, with the sample comparison it ships with: the
// app opens on the cards with the sample's answer, two items typed in get a verdict without a button,
// and Keep lists the comparison under Kept.

test("opens on an answer, answers two typed prices at once, and keeps a comparison", async ({ page }) => {
  await addAsMine(page, "which-is-cheaper.potyro-app.zip", packApp("which-is-cheaper", "which-is-cheaper.app.tsx", ["--seed", "seed.json"]));
  const main = page.getByRole("main");

  // The sample: olive oil, 500 ml at €4.99 against 1 l at €8.49. The bigger bottle wins by 15%.
  await expect(main.getByRole("status")).toContainText("1 l bottle is 15% cheaper");
  const a = main.getByRole("region", { name: "Item A" });
  const b = main.getByRole("region", { name: "Item B" });
  await expect(a).toContainText("per 100 ml");
  await expect(b).toHaveAttribute("data-wins", "true");
  await expect(b).toContainText("15% cheaper");

  // Clear, then type: 1.5 kg at €3.00 against 500 g at €1.20 — A is cheaper by 17%, the kilograms
  // turned into grams. The verdict appears as the last box is filled; nothing is pressed.
  await main.getByRole("button", { name: "Clear" }).click();
  await expect(main.getByRole("status")).toContainText("Type a price and an amount");
  await a.getByLabel("Price").fill("3");
  await a.getByLabel("Amount").fill("1,5");
  await a.getByLabel("Item A Unit").selectOption("kg");
  await b.getByLabel("Price").fill("1.20");
  await b.getByLabel("Amount").fill("500");
  await expect(main.getByRole("status")).toContainText("A is 17% cheaper");
  await expect(a).toHaveAttribute("data-wins", "true");
  await expect(a).toContainText("€0.20 per 100 g");
  await expect(b).toContainText("€0.24 per 100 g");

  // A third item, cheaper still, takes the lead.
  await main.getByRole("button", { name: /Add a third/ }).click();
  const c = main.getByRole("region", { name: "Item C" });
  await expect(c.getByLabel("Item C Unit")).toHaveValue("g"); // the last item's unit, ready to type
  await c.getByLabel("Price").fill("0.90");
  await c.getByLabel("Amount").fill("600");
  await expect(main.getByRole("status")).toContainText("C is 25% cheaper");

  // Kept, under its name, and the list says who won.
  await main.getByRole("button", { name: "Keep" }).click();
  const ask = page.locator(".k-dialog", { hasText: "What is this comparison called?" });
  await expect(ask).toBeVisible();
  await ask.locator("input").fill("Rice");
  await ask.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("heading", { name: "Kept" })).toBeVisible();
  const rows = main.locator(".k-list-row");
  await expect(rows.filter({ hasText: "Rice" })).toContainText("C is 25% cheaper");

  // A kept comparison opens back on its cards.
  await rows.filter({ hasText: "Rice" }).click();
  await expect(main.getByRole("status")).toContainText("C is 25% cheaper");
  if (process.env.SHOT) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: process.env.SHOT });
  }
});
