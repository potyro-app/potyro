import { test, expect } from "@playwright/test";

// The two dead ends a map app hits, driven the way a person hits them:
//
//  1. A `geo` field offered "use my location" and raw lat/lng number boxes. Nobody picks a place by
//     typing coordinates — it needs a map you tap.
//  2. A `relation` to an entity with no records yet was a dead end: creating a Place required a
//     Place Type, so you had to cancel the form, make the type, and start over.

const SOURCE = `import { defineApp } from "potyro";

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
        "potyro:user-apps",
        JSON.stringify([{ id: "places-form", name: "Places Form", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [SOURCE],
  );
});

/**
 * Open the blank create form the way a user reaches it now.
 *
 * The landing page is the Map, and a map page adds inline — you arm placement and tap, which is
 * better than a floating button because the new record lands where you pointed. The shell therefore
 * drops the "New place" quick action on that page. These tests are about what the FORM does, not
 * about where the location came from, and a tapped-out form arrives with the geo field already
 * filled — so they go to the Places list, where adding is still a button and the form opens empty.
 */
async function openBlankForm(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator("h1").first()).toHaveText("Places Form", { timeout: 30_000 });
  await page.getByRole("tab", { name: "Places" }).or(page.getByRole("button", { name: "Places", exact: true })).first().click();
  await page.getByRole("button", { name: /New place/ }).click();
}

test("a geo field is a map you tap, not two number boxes", async ({ page }) => {
  await page.goto("/?user=places-form");
  await openBlankForm(page);
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

  // ...and the HOLDER must be as wide as the canvas it shows. Checking the canvas alone was not
  // enough: the holder had a height but no width, so inside an `align-items: flex-start` column it
  // shrank to 2px and clipped a perfectly well-sized 400px canvas down to a sliver. The canvas
  // assertions above passed the whole time the map looked like an empty rectangle.
  const holder = await form.locator(".k-geo-map").boundingBox();
  expect(holder, "map holder has no layout box").not.toBeNull();
  expect(holder!.width, "map holder collapsed — the canvas is clipped and the map looks blank")
    .toBeGreaterThan(box!.width - 8);
  await expect(form.getByText("Tap the map to place a point")).toBeVisible();
  await expect(form.locator(".k-geo-coords")).toHaveCount(0);

  await form.getByRole("button", { name: "Enter coordinates", exact: true }).click();
  await expect(form.locator('.k-geo-coords input[type="number"]')).toHaveCount(2);
});

test("a relation to an empty entity can create its first record inline", async ({ page }) => {
  await page.goto("/?user=places-form");
  await openBlankForm(page);
  const form = page.locator(".k-modal").first();
  await expect(form).toBeVisible();
  await form.getByLabel(/^Name/).first().fill("Parque Ibirapuera");

  // No Place Type exists yet — the picker says so and still offers to make one, rather than
  // dead-ending. It is a searchable picker now, not a browser <select>.
  const relation = form.locator(".k-relation-input");
  await expect(relation.locator("select")).toHaveCount(0);
  const trigger = relation.getByRole("button", { name: /: choose$/ });
  await expect(trigger).toContainText("No place type yet");
  await trigger.click();
  // What you type becomes the new record's name.
  await page.getByRole("searchbox", { name: /^Search/ }).fill("Park");
  await page.getByRole("button", { name: /New place type “Park”/ }).click();

  // The nested create is a second sheet over the first (#101), and not a <form> — React would
  // bubble its submit to the outer form even through the portal.
  const inline = page.locator(".k-inline-create");
  await expect(inline).toBeVisible();
  expect(await inline.locator("form").count()).toBe(0);
  await expect(page.getByRole("dialog", { name: "Add: Place Type" })).toBeVisible();

  await expect(inline.getByLabel(/^Name/)).toHaveValue("Park");
  await inline.getByRole("button", { name: "Create" }).click();

  // Created AND selected — that is why the user made it.
  await expect(inline).toBeHidden();
  await expect(relation.getByRole("button", { name: /: Park$/ })).toBeVisible();

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
  await openBlankForm(page);
  const form = page.locator(".k-modal");
  await expect(form).toBeVisible();

  await expect(form.getByText(/Map unavailable here/i)).toBeVisible({ timeout: 30_000 });
  // …and the escape hatch is opened for them, so the field is still usable.
  await expect(form.locator('.k-geo-coords input[type="number"]')).toHaveCount(2);
});

// The map is already on screen — tapping it should start the place THERE, so you fill the form with
// the location already set. Opening a second map inside the form was both redundant and fragile
// (a second WebGL context can fail when one map is already rendering).
test("arming placement, then tapping, starts a place at that point", async ({ page }) => {
  await page.goto("/?user=places-form");
  await expect(page.locator("h1").first()).toHaveText("Places Form", { timeout: 30_000 });
  await page.getByRole("tab", { name: "Map" }).or(page.getByRole("button", { name: "Map" })).first().click();

  const canvas = page.locator(".k-map canvas, .maplibregl-canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  // Placement is explicit now. Unarmed, the map is just a map.
  await page.mouse.click(box!.x + 30, box!.y + 30);
  await page.waitForTimeout(600);
  await expect(page.locator(".k-modal"), "an unarmed tap created a place").toHaveCount(0);

  await page.getByRole("button", { name: /Add .* here/i }).click();
  await expect(page.getByText(/Tap the map to place/i)).toBeVisible();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  // The create form opens with the tapped point already in the geo field.
  const form = page.locator(".k-modal");
  await expect(form).toBeVisible({ timeout: 15_000 });
  await expect(form.getByText(/-?\d+\.\d+,\s*-?\d+\.\d+/)).toBeVisible();
});

// A marker is an existing place: tapping it must show that place, NOT start a new one. The
// create-on-tap handler receives marker clicks too, so it has to ignore them.
test("tapping an existing marker shows which place it is, not a new form", async ({ page }) => {
  await page.goto("/?user=places-form");
  await expect(page.locator("h1").first()).toHaveText("Places Form", { timeout: 30_000 });

  // Create the place the way a user now does: arm placement, tap the map, then fill in the name.
  // (Arming is explicit — a bare tap used to create a record, so you could never just look around.)
  const canvas = page.locator(".maplibregl-canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Add .* here/i }).click();
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
  // A pin says which place it is and offers a way in, rather than navigating on touch — so you can
  // look at the map without leaving it.
  const popup = page.locator(".k-map-popup");
  await expect(popup).toBeVisible({ timeout: 10_000 });
  await expect(popup.locator(".k-map-popup-title")).toHaveText("Bar do Zé");
  // …and no create form opened.
  await expect(page.locator(".k-modal")).toHaveCount(0);

  // "Details" rather than "Open": the record's own page now arrives as a sheet over the map, so the
  // framing you navigated to survives reading one pin. The claim is unchanged — the popup is a way
  // into THIS place — so the sheet has to be showing the record we just tapped.
  await popup.getByRole("button", { name: "Details" }).click();
  const sheet = page.getByRole("dialog", { name: "Place" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Bar do Zé" })).toBeVisible();
});
