import { test, expect, type Page } from "@playwright/test";

// A button the APP put on the page, running app code that moves a view (#216).
//
// Before this, the only app code a view could run was a row action or a detail action — both need a
// record — so a page-level button did not exist, and a map could not be moved after it opened. That
// combination is why "add a small button on the map that centers the map in my current location"
// came back from the generator as something the platform could not do.
//
// Places declares `actions: [{ label: "Show all", run: (ctx) => ctx.views.map("map").fit() }]`. What
// is asserted is the map ACTUALLY re-framing, read off the tiles it goes and asks for — a button
// that renders and calls a function that reaches nothing would pass any weaker check.

const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function captureZooms(page: Page): Promise<number[]> {
  const zooms: number[] = [];
  await page.route("**/tile.openstreetmap.org/**", async (route) => {
    const m = /\/(\d+)\/\d+\/\d+\.png(?:\?|$)/.exec(route.request().url());
    if (m) zooms.push(Number(m[1]));
    await route.fulfill({ status: 200, contentType: "image/png", body: TILE });
  });
  return zooms;
}

test("an app's own button on a page can move the map", async ({ page }) => {
  const zooms = await captureZooms(page);
  await page.goto("/?app=places");
  await expect(page.locator("h1")).toHaveText("Places");
  await page.locator(".k-tab", { hasText: "Map" }).click();
  await expect(page.locator(".maplibregl-marker")).toHaveCount(3);

  // The app declared it, so it is in the page's chrome with the app's own label — not a prettified
  // identifier, which is all a key-named action could ever show.
  const showAll = page.locator(".k-page-action", { hasText: "Show all" });
  await expect(showAll).toBeVisible();

  // Zoom right in on one corner, so "show me all of them" has something to undo.
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (!box) throw new Error("map canvas has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -400);
  await expect.poll(() => (zooms.length ? Math.max(...zooms) : 0), { timeout: 15_000 }).toBeGreaterThan(9);

  zooms.length = 0;
  await showAll.click();

  // Back out to a view that holds three places in three countries, from a street. Polled rather than
  // measured once: `fitBounds` animates, so tiles arrive from the zoom it left through the ones it
  // passes on the way. Not pinned to an exact level — the same fit lands a step apart depending on
  // the canvas size when it runs — but z8-from-z12 is not a rounding difference.
  await expect.poll(() => (zooms.length ? Math.min(...zooms) : 99), { timeout: 25_000 }).toBeLessThanOrEqual(8);
  // And all three are on screen — the point of the button.
  await expect(page.locator(".maplibregl-marker")).toHaveCount(3);
});
