import { readFileSync } from "node:fs";
import { test, expect, type Page } from "./console-guard";

// `scope` (#134): the one record everything else belongs to. This is the journey that opened the
// issue — "select a trip, then everything shows that trip" — driven as a person would: with no trip
// yet the page offers a first one in place (never a question), a new place belongs to the trip
// you are in, switching trips from the title changes what every page shows, and the choice survives a
// reload. Fails without the switcher, the runtime's `setScope`, or the form default.

const SOURCE = readFileSync(new URL("./fixtures/trips.app.ts.txt", import.meta.url), "utf8");

async function seed(page: Page): Promise<void> {
  await page.addInitScript((source) => {
    if (localStorage.getItem("potyro:user-apps")) return;
    localStorage.setItem(
      "potyro:user-apps",
      JSON.stringify([{ id: "trips", name: "Trips", source, updatedAt: new Date(0).toISOString(), trusted: true }]),
    );
  }, SOURCE);
}

const chip = (page: Page) => page.locator(".k-scope");
const menu = (page: Page) => page.getByRole("menu");

/** Fill the trip form that is open — the first one on open, or one asked for from the switcher. */
async function createTrip(page: Page, city: string): Promise<void> {
  const form = page.locator(".k-form");
  await form.getByLabel(/City/).fill(city);
  await form.getByRole("button", { name: "Create" }).click();
  await expect(chip(page)).toContainText(city);
}

test("a required scope is asked for on open, scopes every page, and is remembered", async ({ page }) => {
  await seed(page);
  await page.goto("/?user=trips");
  await expect(page.locator("h1").first()).toHaveText("Trips");

  // Nothing to choose from yet: the page offers a first trip in place — no question, no form
  // popping up on its own.
  await expect(chip(page)).toContainText("Choose");
  await expect(page.locator(".k-form")).toHaveCount(0);
  await page.locator(".k-scope-empty").getByRole("button", { name: "New Trip" }).click();
  await createTrip(page, "Berlin");

  // A new place belongs to the trip you are in — the relation defaulted to the scope.
  await page.getByRole("button", { name: /Add: Place/ }).first().click();
  const form = page.locator(".k-form");
  await form.getByLabel(/Name/).fill("Cozy Bar");
  await form.getByRole("button", { name: "Create" }).click();
  // The quick action lands on the new record; its trip was defaulted, never typed.
  await expect(page.locator("article.k-detail")).toContainText("Berlin");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Places" }).click();
  await expect(page.locator(".k-list-row", { hasText: "Cozy Bar" })).toContainText("Berlin");

  // Another trip, from the title: the page narrows to it (nothing there yet), with no record written.
  await chip(page).click();
  await menu(page).getByRole("menuitem", { name: "New Trip" }).click();
  await createTrip(page, "Lisbon");
  await expect(page.locator(".k-list-row", { hasText: "Cozy Bar" })).toHaveCount(0);
  // The tab and the empty state are functions of the selection (#133).
  await expect(page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Places in Lisbon" })).toBeVisible();
  await expect(page.locator(".k-empty")).toHaveText("No places in Lisbon yet.");

  // Back to Berlin from the title.
  await chip(page).click();
  await menu(page).getByRole("menuitem", { name: "Berlin" }).click();
  await expect(chip(page)).toContainText("Berlin");
  await expect(page.locator(".k-list-row", { hasText: "Cozy Bar" })).toBeVisible();

  // Remembered on this device: no question on the next open, and the same trip.
  await page.reload();
  await expect(page.locator("h1").first()).toHaveText("Trips");
  await expect(chip(page)).toContainText("Berlin");
  await expect(page.locator(".k-form")).toHaveCount(0);
  await expect(page.locator(".k-list-row", { hasText: "Cozy Bar" })).toBeVisible();
});

test("an optional selection reads as the app's own name until one is chosen, and Show all goes back", async ({ page }) => {
  // Places files places in lists, but shows every place until a list is chosen.
  await page.goto("/?user=places");
  const scope = page.locator(".k-scope");
  await expect(scope.locator(".k-scope-name")).toHaveText("Places", { timeout: 30_000 });
  await expect(scope).not.toContainText("Choose");
  await scope.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Show all" })).toBeVisible();
  const first = menu.getByRole("menuitem").nth(1);
  const name = ((await first.textContent()) ?? "").trim();
  await first.click();
  await expect(scope.locator(".k-scope-name")).toHaveText(name);
  await scope.click();
  await menu.getByRole("menuitem", { name: "Show all" }).click();
  await expect(scope.locator(".k-scope-name")).toHaveText("Places");
});
