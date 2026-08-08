import { test, expect, type Page } from "@playwright/test";

// Three things that were true but unproven in a real browser:
//
//  1. The map's non-default `camera` modes. `"remember"` is exercised by the places example; `"fit"`
//     and a fixed `{ center, zoom }` were only covered by unit tests against a FAKED MapLibre, which
//     cannot catch a wrong option name or a value MapLibre rejects.
//  2. Strict validation *reaching the user*. Unknown view/page keys are now errors, but nothing
//     checked the error is legible rather than a Zod dump.
//  3. The `steps` view, which until now rendered "arrives in a later milestone".

const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Every tile requested — the only way to observe the camera from outside the map. */
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

/** Which tile column a longitude falls in at a given zoom (the standard slippy-map formula). */
const tileX = (lng: number, z: number): number => Math.floor(((lng + 180) / 360) * 2 ** z);

function mapApp(camera: string): string {
  return `import { defineApp } from "karta";

export default defineApp({
  id: "cam",
  name: "Cam",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    spot: { label: "Spot", displayField: "name", fields: { name: { type: "text", required: true }, loc: { type: "geo" } } },
  },
  pages: [{ id: "map", title: "Map", view: { type: "map", entity: "spot", geo: "loc", title: "name", camera: ${camera} } }],
});
`;
}

async function seed(page: Page, source: string, data?: Record<string, unknown>[]): Promise<void> {
  await page.addInitScript(
    ([src, rows]) => {
      if (localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([{ id: "cam", name: "Cam", source: src, updatedAt: new Date(0).toISOString(), trusted: true }]),
      );
      if (rows) {
        const records: Record<string, unknown> = {};
        (rows as Record<string, unknown>[]).forEach((r, i) => {
          records[`s${i}`] = { id: `s${i}`, createdAt: "", updatedAt: "", ...r };
        });
        localStorage.setItem(
          "karta:user:cam",
          JSON.stringify({ records: { spot: records }, blobs: {}, kv: {}, schemaVersion: 1 }),
        );
      }
    },
    [source, data ?? null] as [string, Record<string, unknown>[] | null],
  );
}

const SPOTS = [
  { name: "A", loc: { lat: 52.52, lng: 13.405 } },
  { name: "B", loc: { lat: 52.53, lng: 13.42 } },
];

test('camera "fit" frames the markers instead of restoring a position', async ({ page }) => {
  const tiles = await captureTiles(page);
  await seed(page, mapApp('"fit"'), SPOTS);
  await page.goto("/?user=cam");
  await expect(page.locator("h1")).toHaveText("Cam");
  await expect(page.locator(".maplibregl-marker")).toHaveCount(2);
  // Poll for the FITTED tiles, not merely for any tile: the map opens on the world camera and only
  // fits once the markers resolve, so "a tile arrived" is true well before the fit has happened.
  await expect.poll(() => Math.max(0, ...tiles.map((t) => t.z)), { timeout: 15_000 }).toBeGreaterThan(8);

  // Move the map, reload: "fit" must NOT remember — it re-frames every time.
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 400); // zoom OUT
  await page.waitForTimeout(800);

  tiles.length = 0;
  await page.reload();
  await expect(page.locator(".maplibregl-marker")).toHaveCount(2);
  await expect.poll(() => Math.max(0, ...tiles.map((t) => t.z)), { timeout: 15_000 }).toBeGreaterThan(8);
  // Nothing was written to the app's storage, because "fit" doesn't record moves.
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem("karta:user:cam");
    return raw ? ((JSON.parse(raw) as { kv?: Record<string, string> }).kv?.["kv:map:map:camera"] ?? null) : null;
  });
  expect(saved).toBeNull();
});

test("a fixed camera opens at its own spot and stays there", async ({ page }) => {
  const tiles = await captureTiles(page);
  // Paris — nowhere near the Berlin markers, so the tiles prove which framing won.
  await seed(page, mapApp("{ center: [2.35, 48.85], zoom: 11 }"), SPOTS);
  await page.goto("/?user=cam");
  await expect(page.locator("h1")).toHaveText("Cam");
  await expect(page.locator(".maplibregl-marker")).toHaveCount(2);
  await expect.poll(() => Math.max(0, ...tiles.map((t) => t.z)), { timeout: 15_000 }).toBeGreaterThan(2);

  // Assert WHERE, not the zoom number: a raster source with 256px tiles requests one zoom level
  // finer than the map's, so pinning `z === 11` would be testing MapLibre's tiling, not the camera.
  const z = Math.max(...tiles.map((t) => t.z));
  expect(z).toBeGreaterThan(2); // not the world view
  const paris = tileX(2.35, z);
  const berlin = tileX(13.405, z);
  const columns = tiles.filter((t) => t.z === z).map((t) => t.x);
  expect(Math.min(...columns.map((x) => Math.abs(x - paris)))).toBeLessThanOrEqual(2);
  expect(Math.min(...columns.map((x) => Math.abs(x - berlin)))).toBeGreaterThan(2);
});

test("an unknown view key is refused with a message you can act on", async ({ page }) => {
  // The trap this closes: a silently-accepted `zoomLevel: 12` looks exactly like a working feature
  // until someone notices the map never moves. It has to fail, and it has to say where.
  await page.goto("/?app=recipes");
  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-preview h1")).toBeVisible();
  await studio.getByRole("tab", { name: "Source" }).click();

  const source = studio.getByRole("textbox", { name: "App source" });
  await source.fill(`import { defineApp } from "karta";

export default defineApp({
  id: "bogus", name: "Bogus", version: "1.0.0", schemaVersion: 1,
  entities: { thing: { fields: { name: { type: "text" } } } },
  pages: [{ id: "p", title: "P", view: { type: "list", entity: "thing", zoomLevel: 12 } }],
});
`);
  await studio.getByRole("button", { name: /Run/ }).click();

  const error = studio.locator(".k-studio-error");
  await expect(error).toBeVisible();
  // Names the offending key and where it is — not just "invalid".
  await expect(error).toContainText("zoomLevel");
});

test("the steps view walks an ordered list and remembers where you got to", async ({ page }) => {
  const source = `import { defineApp } from "karta";

export default defineApp({
  id: "cam",
  name: "Cam",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    spot: {
      label: "Spot",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        steps: { type: "list", ordered: true, of: { text: { type: "text", required: true } } },
      },
    },
  },
  pages: [
    { id: "list", title: "Spots", view: { type: "list", entity: "spot", display: { primary: "name" },
      onOpen: { page: "walk", param: { spotId: "id" } } } },
    { id: "walk", title: "Walk", hidden: true,
      view: { type: "steps", entity: "spot", param: "spotId", list: "steps", text: "text" } },
  ],
});
`;
  await seed(page, source, [{ name: "Morning", steps: [{ text: "Wake up" }, { text: "Coffee" }] }]);
  await page.goto("/?user=cam");
  await expect(page.locator("h1")).toHaveText("Cam");
  await page.locator(".k-list-row", { hasText: "Morning" }).click();

  // Not the placeholder it used to render.
  await expect(page.locator(".k-placeholder-view")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("0 of 2 done");
  await expect(page.getByText("Wake up")).toBeVisible();

  await page.getByRole("checkbox").first().check();
  await expect(page.getByRole("status")).toHaveText("1 of 2 done");

  // Progress survives a reload — the point of a walk-through you can leave.
  await page.reload();
  await page.locator(".k-list-row", { hasText: "Morning" }).click();
  await expect(page.getByRole("status")).toHaveText("1 of 2 done");
});

const PLACES_APP = `import { defineApp } from "karta";

export default defineApp({
  id: "cam",
  name: "Cam",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    spot: { label: "Spot", displayField: "name", fields: { name: { type: "text", required: true }, loc: { type: "geo" } } },
  },
  pages: [
    { id: "map", title: "Map", view: { type: "map", entity: "spot", geo: "loc", title: "name",
      onOpen: { page: "one", param: { spotId: "id" } } } },
    { id: "one", title: "Spot", hidden: true, view: { type: "detail", entity: "spot", param: "spotId",
      sections: [{ fields: ["name"] }] } },
  ],
});
`;

test("a tap on the map does nothing until placing is armed", async ({ page }) => {
  // It used to create a record on ANY empty-map tap: panning or just looking around made records by
  // accident, and there was no way to interact with the map at all without creating something.
  await captureTiles(page);
  await seed(page, PLACES_APP, SPOTS);
  await page.goto("/?user=cam");
  await expect(page.locator(".maplibregl-marker")).toHaveCount(2);

  const box = (await page.locator(".k-map-canvas").boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + 40);
  await page.waitForTimeout(700);
  await expect(page.locator(".k-modal"), "an unarmed tap created a record").toHaveCount(0);

  // Arm it, and the map says what it now expects.
  await page.getByRole("button", { name: /Add spot here/i }).click();
  await expect(page.getByText(/Tap the map to place the spot/i)).toBeVisible();

  await page.mouse.click(box.x + 90, box.y + 90);
  await expect(page.locator(".k-modal")).toBeVisible();
  // The tapped point came through, so the form opens already knowing where.
  await expect(page.locator(".k-modal .k-geo-map")).toBeVisible();
});

test("tapping a pin shows which place it is, with a way in", async ({ page }) => {
  // Navigating straight off the tap meant every touch left the page — you could never just look.
  await captureTiles(page);
  await seed(page, PLACES_APP, SPOTS);
  await page.goto("/?user=cam");
  await expect(page.locator(".maplibregl-marker")).toHaveCount(2);

  await page.locator(".maplibregl-marker").first().click();
  const popup = page.locator(".k-map-popup");
  await expect(popup).toBeVisible();
  await expect(popup.locator(".k-map-popup-title")).toHaveText(/A|B/);
  // Still on the map — looking at a pin is not navigation.
  await expect(page.locator(".k-map-canvas")).toBeVisible();

  await popup.getByRole("button", { name: "Open" }).click();
  await expect(page.locator(".k-detail")).toBeVisible();
});
