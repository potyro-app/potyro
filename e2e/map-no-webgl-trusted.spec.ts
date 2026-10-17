import { test, expect, type Page } from "./console-guard";

// A map in a browser that cannot draw one (no WebGL2: WebGL switched off, a graphics driver Firefox
// has blocklisted, a hardened profile — and Playwright's headless Firefox). MapLibre 6 builds such a
// map without a painter and throws from its first resize() and from remove(): the error escaped a
// React cleanup and the whole app went blank, in Firefox, the moment a map page was left. Now the
// places are listed instead, each opens, the form's place is typed, and nothing is thrown.
//
// WebGL is taken away by script, so every engine runs the same case whatever its own GPU can do.

test.use({ viewport: { width: 1280, height: 800 } });

async function withoutWebGL(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (/webgl/i.test(kind)) return null;
      return (real as (...a: unknown[]) => RenderingContext | null).call(this, kind, ...rest);
    } as typeof real;
  });
}

test("Places without WebGL: the map page lists the places, one opens, and leaving the page leaves the app standing", async ({ page }) => {
  await withoutWebGL(page);
  await page.goto("/?app=places");
  await expect(page.locator("h1")).toHaveText("Places");

  await page.locator(".k-tab", { hasText: "Map" }).click();
  const list = page.locator(".k-map-list");
  await expect(list.getByRole("note")).toHaveText("This browser can’t draw maps, so the places are listed instead.");
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
  const cafe = list.getByRole("button", { name: /Corner Café/ });
  await expect(cafe).toBeVisible();

  // A place opens over the page, as a pin's Details would.
  await cafe.click();
  const sheet = page.locator(".k-map-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("article.k-detail")).toContainText("Corner Café");
  await sheet.getByRole("button", { name: "Close" }).click();

  // Leaving the map page: this is what blanked the app.
  await page.locator(".k-tab", { hasText: "All places" }).click();
  await expect(page.locator(".k-list-row", { hasText: "Corner Café" })).toBeVisible();
  await expect(page.locator("h1")).toHaveText("Places");
});

test("Places without WebGL: adding a place types its location instead of tapping a map", async ({ page }) => {
  await withoutWebGL(page);
  await page.goto("/?app=places");
  await page.locator(".k-tab", { hasText: "Map" }).click();
  await page.locator(".k-map-list").getByRole("button", { name: /^Add: / }).click();
  const form = page.locator(".k-modal");
  await expect(form).toBeVisible();
  await expect(form.getByText("This browser can’t draw maps. Use your location, or type the coordinates.")).toBeVisible();
  await expect(form.getByRole("spinbutton", { name: "lat" })).toBeVisible();
  await expect(form.locator(".k-geo-map")).toBeHidden();
});
