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

  // The gesture is only recorded on moveend, so wait for the write rather than a fixed timeout.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("karta:user:places");
        return raw ? ((JSON.parse(raw) as { kv?: Record<string, string> }).kv?.["kv:map:map:camera"] ?? null) : null;
      }),
    )
    .not.toBeNull();
  const zoomedTo = await page.evaluate(() => {
    const kv = (JSON.parse(localStorage.getItem("karta:user:places")!) as { kv: Record<string, string> }).kv;
    return (JSON.parse(kv["kv:map:map:camera"]!) as { zoom: number }).zoom;
  });
  expect(zoomedTo).toBeGreaterThan(6);

  // Reload and come back: the map must open at that framing, not on the world.
  zooms.length = 0;
  await openMap(page);
  await expect(page.locator(".maplibregl-marker")).not.toHaveCount(0);
  await expect.poll(() => zooms.length).toBeGreaterThan(0);

  // World view fetches z0–z2 tiles; a restored close-up never does.
  expect(Math.min(...zooms)).toBeGreaterThan(2);
  expect(Math.max(...zooms)).toBeGreaterThanOrEqual(Math.floor(zoomedTo) - 1);
});
