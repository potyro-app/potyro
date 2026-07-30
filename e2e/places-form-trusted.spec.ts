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
        location: { type: "geo" },
        type: { type: "relation", to: "placeType" },
      },
    },
  },
  pages: [
    { id: "places", title: "Places", view: { type: "list", entity: "place", display: { primary: "name" } } },
    { id: "types", title: "Types", view: { type: "list", entity: "placeType", display: { primary: "name" } } },
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
  await expect(form.locator(".k-geo-map")).toBeVisible({ timeout: 30_000 });
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

  // The outer form still saves normally.
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText("Parque Ibirapuera")).toBeVisible();
});
