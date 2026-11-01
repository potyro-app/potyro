import { test, expect, type Page } from "./console-guard";
import { makeDemoLink, stranger } from "./share-demo";

// Make it mine (docs/24 §6): from any shared app — a demo link, a sealed app on this device, a gallery
// link with the remix intent — one path to your own copy you can change. The copy is a new app beside
// the original, sealed like anything from someone else, credited ("Remix of Groceries by Ana"), and
// opens with the Studio greeting it and suggesting changes drawn from the app.

/** Pictures of the flow for a review, only when asked (`POTYRO_REMIX_SHOTS=<dir>`). */
const shot = async (p: Page, name: string): Promise<void> => {
  const dir = process.env.POTYRO_REMIX_SHOTS;
  if (dir) await p.screenshot({ path: `${dir}/${name}.png` });
};

type Saved = { id: string; name: string; source: string; trusted?: boolean; remixOf?: unknown; credit?: unknown };
const savedApps = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Saved[]);

/** A demo link for Groceries, by Ana. */
async function anasLink(page: Page): Promise<string> {
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await page.evaluate(() => localStorage.setItem("potyro:identity:name", "Ana"));
  return makeDemoLink(page, "Groceries");
}

/** The Studio, open on the remix, greeting it. */
async function expectGreeted(viewer: Page): Promise<void> {
  await expect(viewer).toHaveURL(/\/\?user=groceries-remix$/, { timeout: 30_000 });
  const studio = viewer.getByRole("dialog", { name: "App studio" });
  await expect(studio).toBeVisible({ timeout: 30_000 });
  const hello = studio.getByRole("listitem", { name: "The Studio, on your remix" });
  await expect(hello).toContainText("This is your own copy. What would you like to change?");
  await expect(hello).toContainText("Remix of Groceries by Ana");
  // Suggestions from the app itself: its main record is "Item". One fills the box, as typed.
  const chips = hello.getByRole("list", { name: "Changes to start from" }).getByRole("button");
  await expect(chips).toHaveCount(4, { timeout: 30_000 });
  await expect(chips.first()).toHaveText("Add a photo to each “Item”");
  await shot(viewer, "remix-2-studio-greeting");
  await chips.first().click();
  await expect(studio.getByRole("textbox", { name: "Describe the app" })).toHaveValue("Add a photo to each “Item”");
}

test("from a demo link: Make it mine is your own sealed copy, credited, with the Studio asking what to change", async ({ page, browser, baseURL }) => {
  const link = await anasLink(page);
  const { context, page: viewer } = await stranger(browser, baseURL!);
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
  const bar = viewer.locator(".k-demo-bar");
  await expect(bar).toContainText("By Ana");

  await bar.getByRole("button", { name: "Make it mine" }).click();
  const card = viewer.getByRole("dialog", { name: "Make it mine" });
  await expect(card.getByRole("heading", { name: "Groceries" })).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("By Ana");
  await expect(card).toContainText("It runs in the sealed box");
  await expect(card.getByText("I wrote this. Run it as mine.")).toHaveCount(0);
  const samples = card.getByRole("checkbox", { name: /Start with its \d+ sample records/ });
  await expect(samples).toBeChecked();
  await shot(viewer, "remix-1-card");
  await card.getByRole("button", { name: "Make it mine" }).click();

  await expectGreeted(viewer);
  const copy = (await savedApps(viewer)).find((a) => a.id === "groceries-remix")!;
  expect(copy.trusted).toBe(false);
  expect(copy.remixOf).toEqual({ name: "Groceries", by: "Ana" });
  expect(copy.credit).toBeUndefined();
  // Its sample records came with it.
  await viewer.getByRole("button", { name: "Close studio" }).click();
  await expect(viewer.getByRole("checkbox", { name: "Milk" })).toBeVisible({ timeout: 30_000 });
  expect(JSON.parse((await viewer.evaluate(() => localStorage.getItem("potyro:share-counts"))) ?? "{}")).toMatchObject({ "demo-opened": 1, "demo-remixed": 1 });
  await context.close();
});

test("a gallery link with the remix intent opens the Make it mine card over the running app; empty when asked", async ({ page, browser, baseURL }) => {
  const link = await anasLink(page);
  const { context, page: viewer } = await stranger(browser, baseURL!);
  await viewer.goto(`${link}&remix=1`);
  const card = viewer.getByRole("dialog", { name: "Make it mine" });
  await expect(card.getByRole("heading", { name: "Groceries" })).toBeVisible({ timeout: 30_000 });
  // The app is running behind it, sealed: the person sees what they are making their own.
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted");
  await card.getByRole("checkbox", { name: /sample records/ }).uncheck();
  await card.getByRole("button", { name: "Make it mine" }).click();
  await expectGreeted(viewer);
  await viewer.getByRole("button", { name: "Close studio" }).click();
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(viewer.getByRole("checkbox", { name: "Milk" })).toHaveCount(0);
  await context.close();
});

test("a plain demo link opens no card: only `remix=1` asks for it", async ({ page, browser, baseURL }) => {
  const link = await anasLink(page);
  const { context, page: viewer } = await stranger(browser, baseURL!);
  await viewer.goto(`${link}&remix=0`);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
  await expect(viewer.getByRole("checkbox", { name: "Milk" })).toBeVisible();
  await expect(viewer.getByRole("dialog", { name: "Make it mine" })).toHaveCount(0);
  await context.close();
});

test("from a sealed app on this device: Make it mine from its tile; the original is untouched", async ({ page, browser, baseURL }) => {
  const link = await anasLink(page);
  const { context, page: viewer } = await stranger(browser, baseURL!);
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
  // Kept, as a link: sealed, Ana's.
  await viewer.locator(".k-demo-bar").getByRole("button", { name: "Keep this app" }).click();
  const keep = viewer.getByRole("dialog", { name: "Add an app" });
  await keep.getByRole("button", { name: "Add app" }).click({ timeout: 30_000 });
  await expect(viewer).toHaveURL(/\/\?user=groceries$/, { timeout: 30_000 });
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  const before = (await savedApps(viewer)).find((a) => a.id === "groceries")!;
  expect(before).toMatchObject({ trusted: false, credit: { name: "Groceries", by: "Ana" } });

  await viewer.goto("/");
  await viewer.getByRole("button", { name: "Actions for Groceries" }).click();
  const menu = viewer.getByRole("menu");
  // The tile says whose it is.
  await expect(menu).toContainText("By Ana");
  await menu.locator('[data-action="remix"]').click();
  const card = viewer.getByRole("dialog", { name: "Make it mine" });
  await expect(card.getByRole("heading", { name: "Groceries" })).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("By Ana");
  await card.getByRole("button", { name: "Make it mine" }).click();

  await expectGreeted(viewer);
  const apps = await savedApps(viewer);
  const copy = apps.find((a) => a.id === "groceries-remix")!;
  expect(copy).toMatchObject({ trusted: false, remixOf: { name: "Groceries", by: "Ana" } });
  // A second tile, called apart from the first; the original as it was.
  expect(copy.name).toBe("Groceries (remix)");
  const after = apps.find((a) => a.id === "groceries")!;
  expect(after.source).toBe(before.source);
  expect(after.trusted).toBe(false);
  expect(after.remixOf).toBeUndefined();

  // The remix's tile says what it is a remix of, and does not offer Make it mine again.
  await viewer.getByRole("button", { name: "Close studio" }).click();
  await viewer.goto("/");
  await viewer.getByRole("button", { name: "Actions for Groceries (remix)" }).click();
  await expect(viewer.getByRole("menu")).toContainText("Remix of Groceries by Ana");
  await shot(viewer, "remix-3-tile-credit");
  await expect(viewer.getByRole("menu").locator('[data-action="remix"]')).toHaveCount(0);
  await context.close();
});

test("the gallery is one tap away: from Add an app", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).first().click();
  const gallery = page.getByRole("dialog", { name: "Add an app" }).getByRole("link", { name: /From the gallery/ });
  await expect(gallery).toHaveAttribute("href", process.env.POTYRO_GALLERY_URL ?? /\/$/);
  // In this tab (#487): the gallery's Make it mine comes back to the tab that holds the apps.
  await expect(gallery).not.toHaveAttribute("target", /./);
});
