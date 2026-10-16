import { test, expect, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";

// "How can I see the databases for each app?" — the Data page: every app's records on this device,
// read and edited through the same field controls the app uses, without running the app's code.
// Reached from home, from a tile's menu, and from inside any app; an address of its own
// (`?data=<app>`) that Back and a reload understand.
//
// Asserted on what is on screen AND on what the app itself shows afterwards: an edit that the page
// displays but the app never sees would be worse than no page.

const home = async (page: Page): Promise<void> => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Your data/ })).toBeVisible({ timeout: 30_000 });
};

const dataPage = (page: Page) => page.locator(".k-datapage");
const appChoice = (page: Page, name: string) => page.getByRole("navigation", { name: "Apps" }).getByRole("button", { name: new RegExp(`^${name}`) });

test("an example never opened still shows its records, once", async ({ page }) => {
  // The page opens a store the way the app does — so the first-run rows are there without visiting
  // the app first, and the page opening twice (React's strict mode does exactly that) seeds once.
  await home(page);
  await tileAction(page, "Groceries", "data");
  const data = dataPage(page);
  await expect(data.getByRole("tab", { name: /Aisle/ })).toContainText("6");
  await expect(data.locator(".k-data-table tbody tr")).toHaveCount(6);
  await data.getByRole("tab", { name: /Item/ }).click();
  await expect(data.getByRole("cell", { name: "Milk", exact: true })).toBeVisible();

  // And the app, opened afterwards, finds them rather than seeding a second set.
  await page.goto("/?user=groceries");
  await expect(page.getByRole("checkbox", { name: "Milk" })).toHaveCount(1, { timeout: 30_000 });
});

test("an app's records are a table, and an edit there is what the app shows", async ({ page }) => {
  await home(page);
  await tileAction(page, "Groceries", "data");
  await expect(page).toHaveURL(/\?data=groceries$/);

  const data = dataPage(page);
  await expect(appChoice(page, "Groceries")).toHaveAttribute("aria-current", "true");
  await expect(data.getByRole("heading", { level: 2, name: "Groceries" })).toBeVisible();
  await data.getByRole("tab", { name: /Item/ }).click();

  // Declared fields are the columns, labelled as the app labels them; a relation shows its name.
  const table = data.locator(".k-data-table");
  await expect(table.locator("th").first()).toHaveText(/name/i);
  const milk = table.locator("tr", { has: page.getByRole("cell", { name: "Milk", exact: true }) });
  await expect(milk).toHaveCount(1);
  await expect(milk).toContainText("Dairy");

  // Search narrows the rows.
  await data.getByRole("searchbox", { name: "Find in these records" }).fill("yogh");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await data.getByRole("searchbox", { name: "Find in these records" }).fill("");

  // Edit through the app's own record form.
  await milk.click();
  const form = page.locator(".k-sheet").last();
  const name = form.getByRole("textbox").first();
  await expect(name).toHaveValue("Milk");
  await name.fill("Oat milk");
  await form.getByRole("button", { name: /^Save/ }).click();
  await expect(table.getByRole("cell", { name: "Oat milk", exact: true })).toBeVisible();

  // Delete, after asking.
  const yoghurt = table.locator("tr", { has: page.getByRole("cell", { name: "Yoghurt", exact: true }) });
  await yoghurt.getByRole("button", { name: "Delete Yoghurt" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(yoghurt).toHaveCount(0);

  // The app sees both.
  await data.getByRole("button", { name: /Open app/ }).click();
  await expect(page.getByRole("checkbox", { name: "Oat milk" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("checkbox", { name: "Yoghurt" })).toHaveCount(0);
});

test("from inside an app, Data opens on that app and Back returns to it", async ({ page }) => {
  await page.goto("/?user=groceries");
  await expect(page.getByRole("checkbox", { name: "Milk" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Data" }).click();

  await expect(page).toHaveURL(/\?data=groceries$/);
  await expect(appChoice(page, "Groceries")).toHaveAttribute("aria-current", "true");
  await dataPage(page).getByRole("tab", { name: /Item/ }).click();
  await expect(dataPage(page).getByRole("cell", { name: "Milk", exact: true })).toBeVisible();

  // A reload lands on the same app's data.
  await page.reload();
  await expect(appChoice(page, "Groceries")).toHaveAttribute("aria-current", "true", { timeout: 30_000 });

  await dataPage(page).getByRole("button", { name: /Back/ }).click();
  await expect(page.getByRole("checkbox", { name: "Milk" })).toBeVisible({ timeout: 30_000 });
});

test("every app is one tap away, and switching between them loses nothing", async ({ page }) => {
  await home(page);
  await page.getByRole("button", { name: /Your data/ }).click();
  await expect(page).toHaveURL(/\?data$/);
  const data = dataPage(page);
  await appChoice(page, "Groceries").click();
  await expect(page).toHaveURL(/\?data=groceries$/);
  await data.getByRole("tab", { name: /Item/ }).click();
  await expect(data.getByRole("cell", { name: "Milk", exact: true })).toBeVisible();

  // Switch app and back: the page closed Groceries' store and opened it again.
  await appChoice(page, "Places").click();
  await expect(data.getByRole("heading", { level: 2, name: "Places" })).toBeVisible();
  await appChoice(page, "Groceries").click();
  await data.getByRole("tab", { name: /Item/ }).click();
  await expect(data.getByRole("cell", { name: "Milk", exact: true })).toBeVisible();

  // Back leaves the page for home — not through every app looked at — and the app still opens on
  // its own data after the page had it open and closed it.
  await data.getByRole("button", { name: /Back/ }).click();
  await expect(page.getByRole("button", { name: /Your data/ })).toBeVisible({ timeout: 30_000 });
  await tileAction(page, "Groceries", "open");
  await expect(page.getByRole("checkbox", { name: "Milk" })).toBeVisible({ timeout: 30_000 });
});

test("the table takes the screen; on a phone it scrolls inside itself, not the page", async ({ page }) => {
  await home(page);
  await tileAction(page, "Recipes", "data");
  const scroll = dataPage(page).locator(".k-data-scroll");
  await expect(scroll).toBeVisible();
  const desktop = (await scroll.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(desktop.width).toBeGreaterThan(viewport.width * 0.7);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(dataPage(page).getByRole("cell", { name: "Milk", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a thousand records open at once: rows are drawn as you scroll, and search sees them all", async ({ page }) => {
  await page.goto("/?data=groceries");
  await expect(dataPage(page).locator(".k-data-table tbody tr").first()).toBeVisible({ timeout: 30_000 });
  // A thousand items, written straight into the app's store (dev serves the shell's modules).
  await page.evaluate(async () => {
    const { openStore } = await import("/src/open-store.ts");
    const store = await openStore("user:groceries");
    const aisles = await store.all("aisle");
    await store.transaction(async (tx) => {
      for (let i = 0; i < 1000; i++) await tx.insert("item", { name: `Bulk ${i}`, aisle: aisles[i % aisles.length]!.id, bought: false, position: i });
    });
  });
  await page.reload();
  await dataPage(page).getByRole("tab", { name: /Item/ }).click();
  await expect(dataPage(page).locator(".k-data-shown")).toHaveText("1,038 records", { timeout: 30_000 });

  const drawn = dataPage(page).locator(".k-data-table tbody tr:not(.k-data-more)");
  const first = await drawn.count();
  expect(first).toBeLessThan(400);

  // Scrolling to the end draws more.
  await dataPage(page).locator(".k-data-scroll").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect.poll(() => drawn.count()).toBeGreaterThan(first);

  // Search covers every row, drawn or not: the first one written sorts last.
  await dataPage(page).getByRole("searchbox", { name: "Find in these records" }).fill("Bulk 0");
  await expect(dataPage(page).getByRole("cell", { name: "Bulk 0", exact: true })).toBeVisible();
});
