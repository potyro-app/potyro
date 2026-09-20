import { test, expect, type Page } from "@playwright/test";

// "I want to add a small button on the map that centers the map in my current location."
//
// Asked for exactly that, the generator refused — correctly: the map's camera was read once, when
// the view opened, and no action, ctx member or button could move it afterwards. That is a platform
// gap, not an app's to fix, so the map view grew the button every phone map has.
//
// What is pinned here is that the button MOVES THE MAP, read from the tiles the map goes and asks
// for — the user-visible version of "the camera is somewhere else now". Asserting that the button
// exists, or that geolocation was called, would pass against a button wired to nothing.

test.use({ geolocation: { latitude: 64.1466, longitude: -21.9426 }, permissions: ["geolocation"] }); // Reykjavík

/** 1x1 transparent PNG — stubs OSM so the suite is offline-deterministic and tile requests observable. */
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

interface Tile {
  z: number;
  x: number;
  y: number;
}

async function captureTiles(page: Page): Promise<Tile[]> {
  const tiles: Tile[] = [];
  await page.route("**/tile.openstreetmap.org/**", async (route) => {
    const m = /\/(\d+)\/(\d+)\/(\d+)\.png(?:\?|$)/.exec(route.request().url());
    if (m) tiles.push({ z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) });
    await route.fulfill({ status: 200, contentType: "image/png", body: TILE });
  });
  return tiles;
}

/** The slippy-map tile a coordinate falls in — the same arithmetic every tile server uses. */
function tileFor(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
}

async function openMap(page: Page): Promise<void> {
  await page.goto("/?app=places");
  await expect(page.locator("h1")).toHaveText("Places");
  await page.locator(".k-tab", { hasText: "Map" }).click();
  await expect(page.locator(".k-map-canvas")).toBeVisible();
}

test("the map has a button that centres it on where you are", async ({ page }) => {
  const tiles = await captureTiles(page);
  await openMap(page);
  // The seeded places are in Berlin; the device says Reykjavík. Nothing near it is on screen yet.
  await expect(page.locator(".maplibregl-marker")).toHaveCount(3);

  const locate = page.locator(".k-map-locate");
  await expect(locate).toBeVisible();
  tiles.length = 0;
  await locate.click();

  // Close in on Reykjavík — the map asks for tiles around it, at street level rather than the
  // country view it was showing.
  await expect
    .poll(
      () => {
        const close = tiles.filter((t) => t.z >= 15);
        return close.some((t) => {
          const want = tileFor(64.1466, -21.9426, t.z);
          return Math.abs(t.x - want.x) <= 3 && Math.abs(t.y - want.y) <= 3;
        });
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // And it stays there: the position someone deliberately asked for is the one the map opens on
  // next time, exactly as a drag would be.
  await page.waitForTimeout(1_000);
  tiles.length = 0;
  await openMap(page);
  await expect
    .poll(() => tiles.some((t) => t.z >= 15 && Math.abs(t.x - tileFor(64.1466, -21.9426, t.z).x) <= 3), {
      timeout: 15_000,
    })
    .toBe(true);
});
