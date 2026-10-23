import { test, expect, type Locator, type Page } from "../console-guard";
import { openHome, seed } from "./fixture.js";

// Tiles show the app's real identity (#82). Every tile used to be the first letter of its name in
// the same beige square: Plants, Places, Packing list and Pins were four "P"s, and the workout
// example showed "workout" / "W" for an app whose own header says "PPL Log".

const app = (id: string, name: string) => ({
  id,
  name,
  source: `import { defineApp } from "potyro";\nexport default defineApp({ id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, version: "1.0.0", schemaVersion: 1,\n  entities: { item: { fields: { title: { type: "text" } } } }, pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item" } }] });\n`,
  updatedAt: new Date(0).toISOString(),
  trusted: true,
});

const tile = (page: Page, name: string): Locator => page.locator(".k-launch-tile", { hasText: name });
const avatar = (t: Locator) => t.locator(".k-launch-avatar");
const accentOf = (t: Locator) => t.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--tile-accent"));

test("a built-in shows its declared name and accent, not its module id; the card wears its icon", async ({ page }) => {
  await seed(page, []);
  await openHome(page);
  const workout = tile(page, "Workout");
  await expect(workout).toBeVisible();
  // The card is a block of the app's hour with its icon on it, drawn in the system's stroke (#425:
  // Workout declares `icon: "dumbbell"`); the initials are for an app that declares none. A person's
  // own icon for the tile (#83) still wins here.
  await expect(avatar(workout).locator("svg[data-icon='dumbbell'] path")).toBeAttached();
  await expect(avatar(workout)).not.toContainText(/\w/);
  await expect(avatar(workout)).toHaveAttribute("data-kind", "icon");
  expect(await accentOf(workout)).toBe("#B6E62E");
  await expect(page.locator(".k-launch-tile", { hasText: /^W?workout/ })).toHaveCount(0);
  await expect(avatar(tile(page, "Recipes")).locator("svg[data-icon='cooking-pot']")).toBeAttached();
});

test("three apps starting with P are three different tiles", async ({ page }) => {
  await seed(page, [app("pens", "Pens"), app("pots", "Pots"), app("pizza", "Pizza")]);
  await openHome(page);
  // The user's tiles: two of these names are also built-ins, which sit in the section above.
  const mine = (name: string) => page.locator(".k-launch-usertile .k-launch-tile", { hasText: name });
  const tiles = [mine("Pens"), mine("Pots"), mine("Pizza")];
  for (const t of tiles) {
    await expect(t).toBeVisible();
    await expect(avatar(t)).toHaveAttribute("data-kind", "monogram");
  }
  const glyphs = await Promise.all(tiles.map((t) => avatar(t).textContent()));
  const accents = await Promise.all(tiles.map(accentOf));
  // The letters carry the name: two of them, not one.
  for (const g of glyphs) expect(g).toMatch(/^P[A-Z]$/);
  expect(glyphs[2]).not.toBe(glyphs[0]); // Pizza vs Pens
  // The colour is what cannot collide: a hue derived from each app's key.
  expect(new Set(accents).size).toBe(3);
  for (const a of accents) expect(a).toMatch(/^oklch\(/);
});
