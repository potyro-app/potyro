import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";

// `scope` (#134): the one record everything else belongs to. This is the journey that opened the
// issue — "select a trip, then everything shows that trip" — driven as a person would: the app asks
// for a trip when it opens, a new place belongs to the trip you are in, switching trips changes what
// every page shows, and the choice survives a reload. Fails without the scope chip, the runtime's
// `setScope`, or the form default.

const SOURCE = readFileSync(new URL("./fixtures/trips.app.ts.txt", import.meta.url), "utf8");

async function seed(page: Page): Promise<void> {
  await page.addInitScript((source) => {
    if (localStorage.getItem("karta:user-apps")) return;
    localStorage.setItem(
      "karta:user-apps",
      JSON.stringify([{ id: "trips", name: "Trips", source, updatedAt: new Date(0).toISOString(), trusted: true }]),
    );
  }, SOURCE);
}

const chip = (page: Page) => page.locator(".k-scope");
const picker = (page: Page) => page.getByRole("dialog", { name: "Choose" });

async function createTrip(page: Page, city: string): Promise<void> {
  await picker(page).getByRole("button", { name: /New Trip/ }).click();
  const form = page.locator(".k-form");
  await form.getByLabel(/City/).fill(city);
  await form.getByRole("button", { name: "Create" }).click();
  await expect(chip(page)).toContainText(city);
}

test("a required scope is asked for on open, scopes every page, and is remembered", async ({ page }) => {
  await seed(page);
  await page.goto("/?user=trips");
  await expect(page.locator("h1").first()).toHaveText("Trips");

  // Nothing to choose from yet: the picker offers only to create one.
  await expect(picker(page)).toBeVisible();
  await expect(chip(page)).toContainText("Choose");
  await createTrip(page, "Berlin");

  // A new place belongs to the trip you are in — the relation defaulted to the scope.
  await page.getByRole("button", { name: /New Place/ }).first().click();
  const form = page.locator(".k-form");
  await form.getByLabel(/Name/).fill("Cozy Bar");
  await form.getByRole("button", { name: "Create" }).click();
  // The quick action lands on the new record; its trip was defaulted, never typed.
  await expect(page.locator("article.k-detail")).toContainText("Berlin");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Places" }).click();
  await expect(page.locator(".k-list-row", { hasText: "Cozy Bar" })).toContainText("Berlin");

  // Another trip: the page narrows to it (nothing there yet), with no record written.
  await chip(page).click();
  await createTrip(page, "Lisbon");
  await expect(page.locator(".k-list-row", { hasText: "Cozy Bar" })).toHaveCount(0);
  // The tab and the empty state are functions of the selection (#133).
  await expect(page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Places in Lisbon" })).toBeVisible();
  await expect(page.locator(".k-empty")).toHaveText("No places in Lisbon yet.");

  // Back to Berlin through the picker's rows.
  await chip(page).click();
  await picker(page).getByRole("button", { name: "Berlin" }).click();
  await expect(chip(page)).toContainText("Berlin");
  await expect(page.locator(".k-list-row", { hasText: "Cozy Bar" })).toBeVisible();

  // Remembered on this device: no question on the next open, and the same trip.
  await page.reload();
  await expect(page.locator("h1").first()).toHaveText("Trips");
  await expect(chip(page)).toContainText("Berlin");
  await expect(picker(page)).toHaveCount(0);
  await expect(page.locator(".k-list-row", { hasText: "Cozy Bar" })).toBeVisible();
});
