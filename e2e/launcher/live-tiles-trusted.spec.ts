import { test, expect, type Locator, type Page } from "../console-guard";
import { openHome, seed, useStart } from "./fixture.js";

// The Tiles home screen (the Start style), chosen in Look; Classic is the default (#96).
test.beforeEach(async ({ page }) => {
  await useStart(page);
});

// The Start screen's tiles (#96; owner, 2026-10-15): each app's hour on the colour clock as a button
// wears it, words on it that read (AA; #428), and the live face an app declares (`AppDefinition.tile`,
// docs/04 §Tile) — run after the wall paints, run again when the app's data changes, silent when it fails.

const tile = (page: Page, key: string): Locator => page.locator(`.k-metro-wall .k-metro-cell[data-key="${key}"] .k-metro-tile`);
const liveFace = (page: Page, key: string): Locator => page.locator(`.k-metro-wall .k-metro-cell[data-key="${key}"] .k-metro-face-live`);

/** The lowest contrast of any words drawn on the tile — the tile's own ink and every text node inside
 *  it, the live face's headline and lines too — each colour composited over the nearest background
 *  under it, as WCAG computes it. Read back through a canvas, so any colour syntax (and alpha) works.
 *  Words for the ear only, and words over a photo (which has no one colour under it), are skipped. */
async function contrastOnTile(t: Locator): Promise<{ min: number; worst: string; checked: number }> {
  return t.evaluate((tileEl) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const paint = (...layers: string[]): [number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      for (const css of ["#000", ...layers]) {
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
      }
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!];
    };
    const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = ([r, g, b]: [number, number, number]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const transparent = (css: string) => css === "transparent" || /rgba\(.*,\s*0\)$/.test(css);
    const ground = (el: Element): string => {
      for (let at: Element | null = el; at; at = at.parentElement) {
        const bg = getComputedStyle(at).backgroundColor;
        if (!transparent(bg)) return bg;
        if (at === tileEl) break;
      }
      return getComputedStyle(tileEl).backgroundColor;
    };
    const measure = (el: Element): number => {
      const bg = ground(el);
      const [a, b] = [lum(paint(bg)), lum(paint(bg, getComputedStyle(el).color))].sort((x, y) => y - x);
      return (a! + 0.05) / (b! + 0.05);
    };
    let min = measure(tileEl);
    let worst = "the tile";
    let checked = 1;
    const walk = document.createTreeWalker(tileEl, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent?.trim()) continue;
      if (el.closest(".k-visually-hidden") || el.closest(".k-metro-face")?.querySelector(":scope > .k-metro-photo")) continue;
      const c = measure(el);
      checked++;
      if (c < min) [min, worst] = [c, `${el.className}: "${n.textContent.trim()}"`];
    }
    return { min, worst, checked };
  });
}

test.describe("first run, the examples", () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  test("every tile is its app's hour on the colour clock, with words on it that read", async ({ page }) => {
    // DESIGN.md §3.1: an app's colour is an angle; its tile is that hour's button pair — for Plants'
    // green the traço with graphite. A declared colour gives only its hue — #7FCF8E is not painted as written.
    await page.goto("/");
    await expect(tile(page, "user:plants")).toBeVisible({ timeout: 30_000 });
    const keys = await page.locator(".k-metro-wall .k-metro-cell[data-key]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.key!));
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const key of keys) {
      const { min, worst } = await contrastOnTile(tile(page, key));
      expect(min, `${key}, ${worst}`).toBeGreaterThanOrEqual(4.5);
    }
    const ink = await tile(page, "user:plants").evaluate((el) => getComputedStyle(el).color);
    expect(ink).toBe("rgb(35, 31, 32)");
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

// The four hours where graphite on the bare traço falls short of AA (rosa 4.49, vermelho 4.26, anil
// 4.32, roxo 4.12): a tile is the hour's button pair (DESIGN.md §3.1 `--accent` / `--on-accent`), the
// tinta with white in the light, so the small words on it read in either theme (#428). Each has a live
// face, so its headline and the smaller lines under it are measured too — those once wore the ink at
// 80%, under AA at a third of the hours.
const hued = (id: string, name: string, accent: string) => ({
  id,
  name,
  source:
    `import { defineApp } from "potyro";\n` +
    `export default defineApp({ id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, version: "1.0.0", schemaVersion: 1,\n` +
    `  theme: { accent: ${JSON.stringify(accent)} },\n` +
    `  tile: async () => ({ title: "3 due", lines: ["Water the fern", "Feed the cat"] }),\n` +
    `  entities: { item: { fields: { title: { type: "text" } } } },\n` +
    `  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } }] });\n`,
  updatedAt: new Date(0).toISOString(),
  trusted: true,
});
const HOURS = [hued("rosa", "Rosa", "#e44f89"), hued("vermelho", "Vermelho", "#e54e3c"), hued("anil", "Anil", "#5d7bf1"), hued("roxo", "Roxo", "#9964e5")];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`every hour, ${colorScheme}`, () => {
    test.use({ colorScheme, viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

    test("a tile's words read on it, whatever the app's hour", async ({ page }) => {
      await seed(page, HOURS);
      await openHome(page);
      for (const { id } of HOURS) {
        await expect(liveFace(page, `user:${id}`)).toContainText("Feed the cat", { timeout: 30_000 });
        const { min, worst, checked } = await contrastOnTile(tile(page, `user:${id}`));
        // The tile, its name, the headline and both lines at least.
        expect(checked, id).toBeGreaterThanOrEqual(5);
        expect(min, `${id}, ${worst}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
}

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
