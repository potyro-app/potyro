import { test, expect, type Page } from "./console-guard";

// Every example in Polish (#303): a Polish browser opens each one and reads the app's own words in
// Polish, as rendered — the name in the header, the tabs, a heading or a button the app declares, and
// words a function builds with `ctx.t` (a plural, a relative date). The records are the seed's and
// stay as written ("Milk", "Fern"): records are never translated (docs/20 §6).
//
// What is NOT checked here is Potyro's own chrome ("More", "Cancel", "New …"): that is the shell's
// catalog (#299/#300), which may still read in English.

test.use({ locale: "pl-PL" });

async function open(page: Page, app: string, name: string): Promise<void> {
  await page.goto(`/?user=${app}`);
  await expect(page.locator("h1").first()).toHaveText(name, { timeout: 30_000 });
}

/** A tab or nav entry the app declares, by its words. */
const tab = (page: Page, words: string) => page.locator(".k-tab, .k-sidenav .k-tab", { hasText: words }).first();

test("groceries reads in Polish", async ({ page }) => {
  await open(page, "groceries", "Zakupy");
  // The quick-add for an aisle is the entity's own label; the aisles and items are records.
  await expect(page.getByText("+ Dział", { exact: true })).toBeVisible();
  await expect(page.getByText("Milk", { exact: true })).toBeVisible();
});

test("plants reads in Polish, with a Polish plural and a Polish relative date", async ({ page }) => {
  await open(page, "plants", "Rośliny");
  await expect(page.getByRole("region", { name: "Podlewanie" })).toContainText("Do podlania teraz");
  // ICU plural from ctx.t: "1 roślina", "2 rośliny", "5 roślin" — never "2 roślin" or "plants".
  await expect(page.getByRole("region", { name: "Podlewanie" })).toContainText(/nic do podlania|\d+ roślin(a|y)? do podlania/);
  // ctx.format.relative inside ctx.t: "podlana 30 dni temu · co 7 dni".
  await expect(page.getByRole("region", { name: "Spragnione" })).toContainText(/podlana .*(temu|dzisiaj|wczoraj)/);
  await expect(page.getByRole("button", { name: "Podlej" }).first()).toBeVisible();
  await expect(tab(page, "Harmonogram")).toBeVisible();
});

test("places reads in Polish", async ({ page }) => {
  await open(page, "places", "Miejsca");
  await expect(page.getByRole("button", { name: /Pokaż wszystkie/ })).toBeVisible();
  await expect(page.getByText("Teraz otwarte").first()).toBeVisible();
  await tab(page, "Według kategorii").click();
  // The fold's group heading and its rows' words come from the app's functions.
  await expect(page.locator(".k-aggregate")).toContainText("Kategorie", { timeout: 30_000 });
  await expect(page.locator(".k-aggregate")).toContainText(/restauracja|kawiarnia|bar|pizzeria|piekarnia|inne/);
});

test("recipes reads in Polish, its custom cook-along view too", async ({ page }) => {
  await open(page, "recipes", "Przepisy");
  // "505 kcal · łatwy": a computed difficulty, put into Polish words by a function.
  await expect(page.locator(".k-card").first()).toContainText(/kcal · (łatwy|średni|trudny)/);
  // The page's one big button, in the app's words.
  await expect(page.getByRole("button", { name: /Dodaj przepis/ }).first()).toBeVisible();
  await page.locator(".k-card", { hasText: "Fluffy Pancakes" }).first().click();
  await expect(page.locator("article.k-detail")).toBeVisible();
  await page.getByRole("button", { name: /Zacznij gotować/ }).first().click();
  await expect(page.locator("#cook-heading")).toHaveText("Gotujemy: Fluffy Pancakes", { timeout: 30_000 });
  // The cook view's own words, from ctx.t inside a custom view.
  await expect(page.getByRole("button", { name: "Następny krok" })).toBeVisible();
  await expect(page.getByText(/Krok 1 z \d+/).first()).toBeVisible();
});

test("a recipe's computed values are headed in Polish, not by their keys (#310)", async ({ page }) => {
  await open(page, "recipes", "Przepisy");
  // Chicken Caesar misses ingredients, so every computed in the group has something to show.
  await page.locator(".k-card", { hasText: "Chicken Caesar" }).first().click();
  const detail = page.locator("article.k-detail");
  await expect(detail).toBeVisible();
  // The "Nutrition & cost" group lists a field (servings) and the computed values beside it.
  await expect(detail.getByText("Wartości odżywcze i koszt", { exact: true })).toBeVisible();
  await expect(detail.locator("dt", { hasText: "Kalorie na porcję" })).toBeVisible();
  await expect(detail.locator("dt", { hasText: "Białko na porcję" })).toBeVisible();
  await expect(detail.locator("dt", { hasText: "Szacowany koszt" })).toBeVisible();
  await expect(detail.locator("dt", { hasText: "Brakujące składniki" })).toBeVisible();
  // What every language read before: the key, humanised.
  await expect(detail.getByText("Calories Per Serving")).toHaveCount(0);
  await expect(detail.getByText("Estimated Cost")).toHaveCount(0);
});

test("a recipe's diet badge reads in Polish, not as its stored value", async ({ page }) => {
  await open(page, "recipes", "Przepisy");
  // The cookbook's cards wear the diet badge.
  const badges = page.locator(".k-card .k-badge");
  await expect(badges.first()).toBeVisible({ timeout: 30_000 });
  // `diet` is a computed returning "vegan" / "vegetarian" / "animal-based"; its `labels` say them in Polish.
  for (const text of await badges.allTextContents()) expect(text).toMatch(/^(wegański|wegetariański|odzwierzęcy)$/);
});

test("an exercise's rolling best reads as kg × reps, not as an object", async ({ page }) => {
  await open(page, "workout", "Dziennik PPL");
  await tab(page, "Program").click();
  await page.locator(".k-list-row", { hasText: "Squat" }).first().getByText("Squat", { exact: true }).click();
  const detail = page.locator("article.k-detail");
  await expect(detail).toBeVisible();
  // The seed's best squat set is 110 kg × 5; a computed returning an object read "…" before.
  await expect(detail.locator("dd", { hasText: "110 kg × 5" })).toBeVisible({ timeout: 30_000 });
  await expect(detail.locator("dd", { hasText: /^…$/ })).toHaveCount(0);
});

test("split reads in Polish", async ({ page }) => {
  await open(page, "split", "Podział");
  await expect(page.getByText("Salda", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Dodaj wydatek/ }).first()).toBeVisible();
  await expect(tab(page, "Płatności")).toBeVisible();
});

test("workout reads in Polish, its live training screen too", async ({ page }) => {
  await open(page, "workout", "Dziennik PPL");
  await expect(page.getByRole("button", { name: /Nowe ćwiczenie/ }).first()).toBeVisible();
  await tab(page, "Trenuj").click();
  await expect(page.locator(".wk-start-title")).toHaveText("Czas na trening?", { timeout: 30_000 });
  // The days are options stored as "push"; the buttons say them in Polish.
  await expect(page.locator(".wk-seg-btn")).toHaveText(["pchanie", "ciągnięcie", "nogi"]);
  await expect(page.locator(".wk-start-btn")).toHaveText("Zacznij trening: pchanie");
});
