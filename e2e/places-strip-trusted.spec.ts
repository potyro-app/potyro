import { test, expect } from "./console-guard";
import { skipWithoutMaps } from "./engines";

// A map with `strip` (Places): the places in view are cards along the bottom, so the map says what
// is here without a tap on every pin. A pin brings its card to the front instead of a popup; a card
// opens the place over the map, so reading one never costs the framing you navigated to.

test("the map's cards: a pin brings its card, a card opens its place", async ({ page }) => {
  await skipWithoutMaps(page);
  await page.goto("/?user=places");
  const cards = page.locator(".k-map-strip > li");
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  expect(await cards.count()).toBeGreaterThan(3);
  // Nothing in front until something is chosen, and no popups on this map.
  await expect(page.locator(".k-map-strip > li[data-selected]")).toHaveCount(0);

  // A pin: its card comes to the front, and the pin stands out.
  // Dispatched on the pin itself: on a fitted map a pin can sit under the strip or under another pin.
  const pin = page.locator(".maplibregl-marker").nth(2);
  await pin.dispatchEvent("click");
  await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
  const chosen = page.locator(".k-map-strip > li[data-selected]");
  await expect(chosen).toHaveCount(1);
  await expect(page.locator(".maplibregl-marker[data-selected]")).toHaveCount(1);
  // …in view: the strip scrolled it there.
  const strip = (await page.locator(".k-map-strip").boundingBox())!;
  await expect
    .poll(async () => {
      const box = (await chosen.boundingBox())!;
      return box.x >= strip.x - 1 && box.x + box.width <= strip.x + strip.width + 1;
    })
    .toBe(true);

  // A swipe along the strip: the card that stops in the middle comes to the front.
  const before = ((await chosen.locator(".k-map-card-title").textContent()) ?? "").trim();
  // One card along — back, if the one in front is already the last.
  await page.locator(".k-map-strip").evaluate((el, by) => el.scrollBy({ left: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 ? -by : by }), (await chosen.boundingBox())!.width + 8);
  await expect(chosen.locator(".k-map-card-title")).not.toHaveText(before);

  // A card: the place's own page, over the map.
  const name = ((await chosen.locator(".k-map-card-title").textContent()) ?? "").trim();
  await chosen.locator(".k-map-card").click();
  const sheet = page.getByRole("dialog", { name: "Place" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".k-detail-title")).toHaveText(name);
});
