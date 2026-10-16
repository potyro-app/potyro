import { test, expect, type Locator, type Page } from "../console-guard";
import { openHome, seed, useStart } from "./fixture.js";

// The Tiles home screen (the Start style), chosen in Look; Classic is the default (#96).
test.beforeEach(async ({ page }) => {
  await useStart(page);
});

// The Start screen's tiles (#96; owner, 2026-10-15): each app's own colour with white on it that
// reads (AA), and the live face an app declares (`AppDefinition.tile`, docs/04 §Tile) — run after the
// wall paints, run again when the app's data changes, silent when it fails.

const tile = (page: Page, key: string): Locator => page.locator(`.k-metro-wall .k-metro-cell[data-key="${key}"] .k-metro-tile`);
const liveFace = (page: Page, key: string): Locator => page.locator(`.k-metro-wall .k-metro-cell[data-key="${key}"] .k-metro-face-live`);

/** White on the tile's painted background, as WCAG computes it — read back through a canvas, so any colour syntax works. */
async function contrastOnTile(t: Locator): Promise<number> {
  return t.evaluate((el) => {
    const bg = getComputedStyle(el).backgroundColor;
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const y = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
    return 1.05 / (y + 0.05);
  });
}

test.describe("first run, the examples", () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  test("every tile is its app's colour with white that reads, and the pale ones are darkened to reach it", async ({ page }) => {
    await page.goto("/");
    await expect(tile(page, "user:plants")).toBeVisible({ timeout: 30_000 });
    const keys = await page.locator(".k-metro-wall .k-metro-cell[data-key]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.key!));
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const key of keys) expect(await contrastOnTile(tile(page, key)), key).toBeGreaterThanOrEqual(4.5);
    // Plants declares #7FCF8E — 1.8:1 under white as written. Its tile is its green, darker.
    const bg = await tile(page, "user:plants").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toMatch(/^rgb\(127, 207, 142\)$/);
  });

  test("a live face shows the app's own data without opening it, and follows a change made in the app", async ({ page }) => {
    await page.goto("/");
    // Plain faces first; the live ones arrive once the tiles have run (tile-runner.ts).
    await expect(liveFace(page, "user:groceries")).toContainText("11 to buy", { timeout: 30_000 });
    await expect(liveFace(page, "user:groceries")).toContainText("Apples");
    await expect(liveFace(page, "user:plants")).toContainText(/\d to water/, { timeout: 30_000 });
    // The same words for the ear.
    await expect(tile(page, "user:groceries")).toContainText("11 to buy");

    // Buy the milk, in the app; home says what is left.
    await page.goto("/?user=groceries");
    await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
    await page.getByRole("checkbox", { name: "Milk" }).click();
    await expect(page.getByRole("checkbox", { name: "Milk" })).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("potyro:launcher") ?? "{}")["user:groceries"]?.tile?.tile?.count), { timeout: 15_000 })
      .toBe(10);
    await page.goto("/");
    await expect(liveFace(page, "user:groceries")).toContainText("10 to buy", { timeout: 30_000 });
    await expect(liveFace(page, "user:groceries")).not.toContainText("Milk");
  });
});

const app = (id: string, name: string, tileFn: string) => ({
  id,
  name,
  source:
    `import { defineApp } from "potyro";\n` +
    `export default defineApp({ id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, version: "1.0.0", schemaVersion: 1,\n` +
    `  tile: ${tileFn},\n` +
    `  entities: { item: { fields: { title: { type: "text" } } } },\n` +
    `  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } }] });\n`,
  updatedAt: new Date(0).toISOString(),
  trusted: true,
});

test("a tile that throws, or never answers, leaves the plain face — no error anywhere", async ({ page }) => {
  await seed(page, [
    app("boom", "Boom", `async () => { throw new Error("the tile broke"); }`),
    app("slow", "Slow", `() => new Promise(() => {})`),
    app("fine", "Fine", `async () => ({ title: "All good", lines: ["one line"] })`),
  ]);
  await openHome(page);
  await expect(liveFace(page, "user:fine")).toContainText("All good", { timeout: 30_000 });
  // Both ran — their answers are recorded, as nothing — and both show the plain face.
  for (const key of ["user:boom", "user:slow"]) {
    await expect
      .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem("potyro:launcher") ?? "{}")[k]?.tile?.at ?? null, key), { timeout: 30_000 })
      .not.toBeNull();
    await expect(liveFace(page, key)).toHaveCount(0);
    await expect(tile(page, key)).toHaveAttribute("data-face", "plain");
  }
  // The console guard fails this test on any error the failures leave behind.
});
