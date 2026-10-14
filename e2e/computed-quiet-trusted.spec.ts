import { test, expect, type Page } from "@playwright/test";

// The owner, on apps.vaz.io: Places showed "This part of the app hit a problem: “Open Now” could not
// be worked out for some records: can't access property "some", hours is undefined" — over the map.
// One place had no opening hours. A value that cannot be worked out for some records is that value,
// empty, for those records: the map is still a map, and the person using the app is not shown an
// alert about code they cannot fix.

/** Add a place the way a person does on a map page: arm placement, tap, name it, create. */
async function addPlaceOnMap(page: Page, name: string): Promise<void> {
  const canvas = page.locator(".maplibregl-canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Add here: /i }).click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const form = page.locator(".k-modal");
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.getByLabel(/^Name/).first().fill(name);
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toBeHidden();
}

/** The map, with nothing over it: its markers are there and no part says it failed. */
async function expectQuietMap(page: Page, markers: number): Promise<void> {
  await expect(page.locator(".maplibregl-marker")).toHaveCount(markers, { timeout: 30_000 });
  await expect(page.locator(".k-map-canvas")).toBeVisible();
  // Watched for a moment: the failure is reported as the records resolve, after the first paint.
  for (let i = 0; i < 4; i += 1) {
    await expect(page.locator(".k-part-problem")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.waitForTimeout(500);
  }
}

test("Places with a place that has no opening hours still shows the map, with every place on it", async ({ page }) => {
  await page.goto("/?app=places");
  await expect(page.locator("h1")).toHaveText("Places", { timeout: 30_000 });
  const markers = page.locator(".maplibregl-marker");
  await expect(markers.first()).toBeVisible({ timeout: 30_000 });
  const before = await markers.count();

  await addPlaceOnMap(page, "Kiosk ohne Zeiten");
  await expectQuietMap(page, before + 1);

  // And it reads as not open — what "no hours" means — rather than as a failure.
  await page.locator(".k-tab", { hasText: "All places" }).click();
  await expect(page.locator(".k-list-row", { hasText: "Kiosk ohne Zeiten" })).toBeVisible();
  await expect(page.locator(".k-part-problem")).toHaveCount(0);
});

// The mechanism, not the example: any app's computed that throws for some records leaves its map
// alone. This one throws for every place without notes — the shape of the Places bug, unguarded.
const SOURCE = `import { defineApp } from "potyro";

export default defineApp({
  id: "pins",
  name: "Pins",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    pin: {
      label: "Pin",
      icon: "📍",
      displayField: "name",
      fields: { name: { type: "text", required: true }, notes: { type: "text" }, location: { type: "geo" } },
      computed: { summary: (p) => p.notes.trim().slice(0, 20) },
    },
  },
  pages: [
    { id: "map", title: "Map", view: { type: "map", entity: "pin", geo: "location", title: "name", display: { primary: "name", secondary: "summary" } } },
    { id: "all", title: "All", view: { type: "list", entity: "pin", display: { primary: "name", secondary: "summary" } } },
  ],
});
`;

test("a computed that throws for a record leaves the map, and the list, showing every record", async ({ page }) => {
  await page.addInitScript(
    ([source]) => {
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "pins", name: "Pins", source, trusted: true, updatedAt: new Date().toISOString() }]));
    },
    [SOURCE],
  );
  await page.goto("/?user=pins");
  await expect(page.locator("h1").first()).toHaveText("Pins", { timeout: 30_000 });

  await addPlaceOnMap(page, "No notes here");
  await expectQuietMap(page, 1);

  await page.locator(".k-tab", { hasText: "All" }).click();
  await expect(page.locator(".k-list-row", { hasText: "No notes here" })).toBeVisible();
  await expect(page.locator(".k-part-problem")).toHaveCount(0);
});
