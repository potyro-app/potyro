import { test, expect, type Page } from "@playwright/test";

// Two map regressions that no amount of editing an app module could fix, because both live in the
// built-in map view (packages/views/src/map.tsx):
//
//  1. Opening a map page rendered ZERO pins. Marker resolution normally beats the lazy MapLibre
//     import, so the marker-sync effect bailed on "no map yet" and nothing re-ran it. Pins appeared
//     only once something else changed the marker set — touching a filter chip.
//  2. The map always opened on the whole world, discarding wherever the user had left it.
//
// Neither is visible to the previous map assertions, which only checked that the canvas rendered and
// the empty-state text was absent — both true while the map sits there blank.

/** 1x1 transparent PNG — stubs OSM so the suite is offline-deterministic and tile zooms observable. */
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Zoom levels of every tile the map has asked for, in order. */
async function captureTileZooms(page: Page): Promise<number[]> {
  const zooms: number[] = [];
  await page.route("**/tile.openstreetmap.org/**", async (route) => {
    const m = /\/(\d+)\/\d+\/\d+\.png(?:\?|$)/.exec(route.request().url());
    if (m) zooms.push(Number(m[1]));
    await route.fulfill({ status: 200, contentType: "image/png", body: TILE });
  });
  return zooms;
}

async function openMap(page: Page): Promise<void> {
  await page.goto("/?app=places");
  await expect(page.locator("h1")).toHaveText("Places");
  await page.locator(".k-tab", { hasText: "Map" }).click();
  await expect(page.locator(".k-map-canvas")).toBeVisible();
}

test("map shows its pins on first open, before any filter is touched", async ({ page }) => {
  await captureTileZooms(page);
  await openMap(page);

  // The seeded places must be on the map immediately. Asserting the *markers*, not just the canvas:
  // a blank map with markers resolved in state passes every weaker check.
  await expect(page.locator(".maplibregl-marker")).toHaveCount(3);
});

test("map reopens where the user left it", async ({ page }) => {
  const zooms = await captureTileZooms(page);
  await openMap(page);
  await expect(page.locator(".maplibregl-marker")).toHaveCount(3);

  // Zoom in by wheel over the canvas — a real user gesture, which is what the map agrees to
  // remember. (Clicking the canvas would open the "add a place here" form instead.)
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (!box) throw new Error("map canvas has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400);

  // How far in the gesture actually got, read from the map rather than from storage.
  //
  // This used to reach into `localStorage` for the saved camera. That was always a claim about
  // where the store keeps things, not about the map, and it stopped being true when local apps
  // moved off localStorage into a real database. The tiles the map asks for say the same thing and
  // are the user-visible version of it.
  await expect.poll(() => (zooms.length ? Math.max(...zooms) : 0), { timeout: 15_000 }).toBeGreaterThan(6);
  const zoomedTo = Math.max(...zooms);

  // The camera is saved when the movement ends, and the save does not block the gesture. A reload
  // fired in the same breath can beat it — which is a race a person could lose too, at the cost of
  // the map opening on the world instead of where they left it. Let it land.
  await page.waitForTimeout(1_000);

  // Reload and come back: the map must open at that framing, not on the world.
  zooms.length = 0;
  await openMap(page);
  await expect(page.locator(".maplibregl-marker")).not.toHaveCount(0);
  await expect.poll(() => zooms.length).toBeGreaterThan(0);

  // World view fetches z0–z2 tiles; a restored close-up never does.
  expect(Math.min(...zooms)).toBeGreaterThan(2);
  expect(Math.max(...zooms)).toBeGreaterThanOrEqual(Math.floor(zoomedTo) - 1);
});
