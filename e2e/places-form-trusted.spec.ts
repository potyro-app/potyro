import { test, expect } from "@playwright/test";

// The two dead ends a map app hits, driven the way a person hits them:
//
//  1. A `geo` field offered "use my location" and raw lat/lng number boxes. Nobody picks a place by
//     typing coordinates — it needs a map you tap.
//  2. A `relation` to an entity with no records yet was a dead end: creating a Place required a
//     Place Type, so you had to cancel the form, make the type, and start over.

const SOURCE = `import { defineApp } from "karta";

export default defineApp({
  id: "places-form",
  name: "Places Form",
  version: "1.0.0",
  schemaVersion: 1,
  permissions: { geo: true },
  quickActions: [{ id: "add-place", label: "New place", icon: "＋", entity: "place", open: true }],
  entities: {
    placeType: {
      label: "Place Type",
      icon: "🏷",
      displayField: "name",
      fields: { name: { type: "text", required: true }, icon: { type: "text" } },
    },
    place: {
      label: "Place",
      icon: "📍",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        type: { type: "relation", to: "placeType" },
        tags: { type: "tags", options: ["favorite", "cheap", "outdoor", "cozy", "date night", "with friends"] },
        photo: { type: "media" },
        description: { type: "text", multiline: true },
        // LAST, like the generated app — the map then mounts below the fold in a scrolled modal.
        location: { type: "geo" },
      },
    },
  },
  pages: [
    { id: "map", title: "Map", view: { type: "map", entity: "place", geo: "location", title: "name", onOpen: { page: "place-detail", param: { placeId: "id" } } } },
    { id: "places", title: "Places", view: { type: "list", entity: "place", display: { primary: "name" } } },
    { id: "types", title: "Types", view: { type: "list", entity: "placeType", display: { primary: "name" } } },
    { id: "place-detail", title: "Place", hidden: true, view: { type: "detail", entity: "place", param: "placeId", sections: [{ fields: ["name", "type", "tags", "description", "location"] }] } },
  ],
});
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([source]) => {
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([{ id: "places-form", name: "Places Form", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [SOURCE],
  );
});

test("a geo field is a map you tap, not two number boxes", async ({ page }) => {
  await page.goto("/?user=places-form");
  await expect(page.locator("h1").first()).toHaveText("Places Form", { timeout: 30_000 });

  await page.getByRole("button", { name: /New place/ }).click();
  const form = page.locator(".k-modal");
  await expect(form).toBeVisible();

  // The map is the input. Coordinates are behind a toggle, not the primary affordance.
  //
  // Asserting the CONTAINER is visible proves nothing — an empty div is visible, which is exactly
  // how a blank map area shipped. MapLibre renders into a <canvas>; require one, sized.
  const canvas = form.locator(".k-geo-map canvas");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  expect(box, "map canvas has no layout box").not.toBeNull();
  expect(box!.width, "map canvas has zero width").toBeGreaterThan(50);
  expect(box!.height, "map canvas has zero height").toBeGreaterThan(50);
  await expect(form.getByText("Tap the map to place a point")).toBeVisible();
  await expect(form.locator(".k-geo-coords")).toHaveCount(0);

  await form.getByRole("button", { name: "Enter coordinates", exact: true }).click();
  await expect(form.locator('.k-geo-coords input[type="number"]')).toHaveCount(2);
});

test("a relation to an empty entity can create its first record inline", async ({ page }) => {
  await page.goto("/?user=places-form");
  await expect(page.locator("h1").first()).toHaveText("Places Form", { timeout: 30_000 });

  await page.getByRole("button", { name: /New place/ }).click();
  const form = page.locator(".k-modal");
  await expect(form).toBeVisible();
  await form.getByLabel(/^Name/).first().fill("Parque Ibirapuera");

  // No Place Type exists yet — the form must offer to make one rather than dead-ending.
  const relation = form.locator(".k-relation-input");
  // `<option>` text is never "visible" to Playwright — assert on the select's content.
  await expect(relation.locator("select")).toContainText("No Place Type yet");
  await relation.getByRole("button", { name: /New Place Type/ }).click();

  // The nested create form must NOT be a <form> inside a <form>.
  const inline = form.locator(".k-inline-create");
  await expect(inline).toBeVisible();
  expect(await inline.locator("form").count()).toBe(0);

  await inline.getByLabel(/^Name/).fill("Park");
  await inline.getByRole("button", { name: "Create" }).click();

  // Created AND selected — that is why the user made it.
  await expect(inline).toBeHidden();
  await expect(relation.locator("select")).toHaveValue(/.+/);
  await expect(relation.locator("select")).toContainText("Park");

  // The outer form still saves normally. (The default page is the Map, so check the list.)
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toBeHidden();
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await expect(page.getByText("Parque Ibirapuera")).toBeVisible();
});

// Tiles come from a third-party host, which a VPN, an ad blocker, or an offline device can block.
// The old behaviour was a silent blank rectangle indistinguishable from a broken app. The field must
// say so and fall back to coordinates.
test("a blocked tile host degrades to a visible message, not an empty area", async ({ page }) => {
  await page.route("**tile.openstreetmap.org/**", (r) => r.abort());

  await page.goto("/?user=places-form");
  await expect(page.locator("h1").first()).toHaveText("Places Form", { timeout: 30_000 });
  await page.getByRole("button", { name: /New place/ }).click();
  const form = page.locator(".k-modal");
  await expect(form).toBeVisible();

  await expect(form.getByText(/Map unavailable here/i)).toBeVisible({ timeout: 30_000 });
  // …and the escape hatch is opened for them, so the field is still usable.
  await expect(form.locator('.k-geo-coords input[type="number"]')).toHaveCount(2);
});

// The map is already on screen — tapping it should start the place THERE, so you fill the form with
// the location already set. Opening a second map inside the form was both redundant and fragile
// (a second WebGL context can fail when one map is already rendering).
test("tapping the map starts a place at that point", async ({ page }) => {
  await page.goto("/?user=places-form");
  await expect(page.locator("h1").first()).toHaveText("Places Form", { timeout: 30_000 });
  await page.getByRole("tab", { name: "Map" }).or(page.getByRole("button", { name: "Map" })).first().click();

  const canvas = page.locator(".k-map canvas, .maplibregl-canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // The create form opens with the tapped point already in the geo field.
  const form = page.locator(".k-modal");
  await expect(form).toBeVisible({ timeout: 15_000 });
  await expect(form.getByText(/-?\d+\.\d+,\s*-?\d+\.\d+/)).toBeVisible();
});

// A marker is an existing place: tapping it must show that place, NOT start a new one. The
// create-on-tap handler receives marker clicks too, so it has to ignore them.
test("tapping an existing marker shows the place, not a new form", async ({ page }) => {
  await page.goto("/?user=places-form");
  await expect(page.locator("h1").first()).toHaveText("Places Form", { timeout: 30_000 });

  // Create the place the way a user now does: tap the map, then fill in the name.
  const canvas = page.locator(".maplibregl-canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const form = page.locator(".k-modal");
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.getByLabel(/^Name/).first().fill("Bar do Zé");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toBeHidden();

  const marker = page.locator(".maplibregl-marker").first();
  await expect(marker).toBeVisible({ timeout: 30_000 });

  await marker.click();
  // With `onOpen`, a pin opens the record's detail — the popup only ever showed the title binding.
  await expect(page.getByText("Bar do Zé")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Place" })).toBeVisible();
  // …and no create form opened.
  await expect(page.locator(".k-modal")).toHaveCount(0);
});
