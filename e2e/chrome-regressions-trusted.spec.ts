import { test, expect, type Page } from "@playwright/test";

// Shell chrome regressions found by actually looking at a running app rather than by reasoning about
// it. Each of these was live and none was caught by the existing suite:
//
//  • header controls at 41px and 64px in the same row, because a squeezed row wrapped text INSIDE
//    the buttons that had an icon
//  • the whole page scrolling sideways on a phone, because that row never wrapped
//  • Edit mode showing the open page's entity fields no matter which ✎ you clicked
//  • "Apply with AI" being the only save-looking button, next to controls that need no model
//  • detail buttons labelled with raw action keys — `snapPhoto`, not "Snap Photo"

const APP_SOURCE = `import { defineApp } from "karta";

export default defineApp({
  id: "chrome",
  name: "A Really Quite Long Application Name",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    place: {
      label: "Place",
      displayField: "name",
      fields: { name: { type: "text", required: true }, note: { type: "text" } },
      actions: { snapPhoto: async () => {}, pinHere: async () => {} },
    },
  },
  pages: [
    { id: "all", title: "All", view: { type: "list", entity: "place", display: { primary: "name" },
      rowActions: ["snapPhoto"], onOpen: { page: "one", param: { placeId: "id" } } } },
    { id: "other", title: "Other", view: { type: "list", entity: "place", display: { primary: "name" } } },
    { id: "one", title: "Place", hidden: true, view: { type: "detail", entity: "place", param: "placeId",
      sections: [{ fields: ["note"] }], actions: ["snapPhoto", "pinHere"] } },
  ],
});
`;

async function open(page: Page, width = 1280): Promise<void> {
  await page.addInitScript((src) => {
    if (localStorage.getItem("karta:user-apps")) return;
    localStorage.setItem(
      "karta:user-apps",
      JSON.stringify([{ id: "chrome", name: "Chrome", source: src, updatedAt: new Date(0).toISOString(), trusted: true }]),
    );
    localStorage.setItem(
      "karta:user:chrome",
      JSON.stringify({ records: { place: { p1: { id: "p1", createdAt: "", updatedAt: "", name: "Somewhere", note: "hi" } } }, blobs: {}, kv: {}, schemaVersion: 1 }),
    );
  }, APP_SOURCE);
  await page.setViewportSize({ width, height: 860 });
  await page.goto("/?user=chrome");
  await expect(page.locator("h1")).toBeVisible();
}

test("every top-bar control is the same height, even with a long app name", async ({ page }) => {
  // The long name is the point: it used to wrap the title and squeeze the actions until each button
  // wrapped its own text and grew. The top bar (#111) truncates the name instead, and its controls
  // are one size, a thumb's.
  await open(page, 390);
  const heights = await page.locator(".k-topbar button").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThan(1);
  expect(new Set(heights).size, `top-bar controls differ in height: ${heights.join(", ")}`).toBe(1);
  expect(heights[0]).toBeGreaterThanOrEqual(44);
  // Also the sidebar's tools on a wide screen.
  await open(page, 1280);
  const tools = await page.locator(".k-tools .k-tool").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(tools.length).toBeGreaterThan(3);
  expect(new Set(tools).size, `tools differ in height: ${tools.join(", ")}`).toBe(1);
});

test("the page never scrolls sideways on a phone", async ({ page }) => {
  await open(page, 390);
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(scrollW, "something is wider than the viewport").toBeLessThanOrEqual(clientW);
});

test("each edit mark offers controls for what it points at", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Edit mode" }).click();

  // The navigation → tab names. Not the open page's fields, which is what it used to show.
  await page.getByRole("button", { name: "Edit the navigation / tabs" }).click();
  await expect(page.locator(".k-structure-heading")).toHaveText("Tab names");
  await expect(page.getByLabel("Name for the All tab")).toBeVisible();
  await expect(page.locator(".k-structure-field")).toHaveCount(0);
  await page.locator(".k-modifydialog").getByRole("button", { name: /Cancel|Close/ }).click();

  // The page → that page's name and its entity's fields.
  await page.locator(".k-editmark").last().click();
  await expect(page.locator(".k-structure-heading")).toContainText("Fields of place");
  await expect(page.getByLabel("Page name")).toBeVisible();
  await expect(page.getByLabel("Label for name")).toBeVisible();
});

test("the tab list offers exactly the tabs that are on screen", async ({ page }) => {
  // The app has three pages but only two tabs: `one` is `hidden` AND a per-record `detail`, so the
  // shell keeps it out of the tab bar. The panel listed every page with a title and offered to
  // rename five "tabs" on an app showing three.
  await open(page);
  const onScreen = await page.locator(".k-tab .k-tab-label").allInnerTexts();

  await page.getByRole("button", { name: "Edit mode" }).click();
  await page.getByRole("button", { name: "Edit the navigation / tabs" }).click();
  await expect(page.locator(".k-structure-heading")).toHaveText("Tab names");

  const offered = await page.locator(".k-structure-row .k-structure-label").allInnerTexts();
  expect(offered.sort(), `panel offers ${offered.length} tabs, screen shows ${onScreen.length}`).toEqual(onScreen.sort());
});

test("an action that fails tells the user instead of failing silently", async ({ page }) => {
  // Every caller runs actions as `void runtime.runAction(...)` from a click handler, so before this
  // a rejection escaped as an unhandled promise rejection: the button appeared to do nothing at all.
  const source = APP_SOURCE.replace(
    "actions: { snapPhoto: async () => {}, pinHere: async () => {} },",
    'actions: { snapPhoto: async () => { throw new Error("camera is not available"); }, pinHere: async () => {} },',
  );
  await page.addInitScript((src) => {
    localStorage.setItem(
      "karta:user-apps",
      JSON.stringify([{ id: "chrome", name: "Chrome", source: src, updatedAt: new Date(0).toISOString(), trusted: true }]),
    );
    localStorage.setItem(
      "karta:user:chrome",
      JSON.stringify({ records: { place: { p1: { id: "p1", createdAt: "", updatedAt: "", name: "Somewhere", note: "hi" } } }, blobs: {}, kv: {}, schemaVersion: 1 }),
    );
  }, source);
  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));

  await page.goto("/?user=chrome");
  await expect(page.locator("h1")).toBeVisible();
  await page.locator(".k-list-row .k-list-text").first().click();
  await page.locator(".k-detail-actions button", { hasText: "Snap Photo" }).click();

  await expect(page.getByText("camera is not available")).toBeVisible();
  expect(crashes, "the failure escaped as an unhandled rejection").toHaveLength(0);
});

test("the AI button appears only when there is something to send", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Edit mode" }).click();
  await page.locator(".k-editmark").last().click();

  // With direct controls right there and nothing typed, an "Apply with AI" button is the only thing
  // that looks like "save" — so a rename reads as needing a model call it does not need.
  const actions = page.locator(".k-modifydialog .k-form-actions button");
  await expect(actions).toHaveText(["Cancel"]);

  await page.getByLabel("Describe the change").fill("make it a gallery");
  await expect(actions).toHaveText(["Cancel", "Apply with AI"]);
});

test("detail actions are labelled, not keyed", async ({ page }) => {
  await open(page);
  await page.locator(".k-list-row .k-list-text").first().click();
  // Waited for, not read on the spot: the record's actions are rendered once it has loaded, and the
  // store answers asynchronously now.
  const buttons = page.locator(".k-detail-actions button");
  await expect(buttons.first()).toBeVisible();
  const labels = await buttons.allInnerTexts();

  expect(labels).toContain("Snap Photo");
  expect(labels).toContain("Pin Here");
  expect(labels).not.toContain("snapPhoto");
});

test("ctx.navigate from an app action actually changes page", async ({ page }) => {
  // The bridge was built as `createNavBridge(() => {})` — an empty function — in both boot paths.
  // So `ctx.navigate` was a documented API that silently did nothing: the action ran, records were
  // created, and the screen never moved. Indistinguishable from a dead button.
  const source = APP_SOURCE.replace(
    "actions: { snapPhoto: async () => {}, pinHere: async () => {} },",
    'actions: { snapPhoto: async () => {}, pinHere: async (r, ctx) => { ctx.navigate("other"); } },',
  );
  await page.addInitScript((src) => {
    localStorage.setItem(
      "karta:user-apps",
      JSON.stringify([{ id: "chrome", name: "Chrome", source: src, updatedAt: new Date(0).toISOString(), trusted: true }]),
    );
    localStorage.setItem(
      "karta:user:chrome",
      JSON.stringify({ records: { place: { p1: { id: "p1", createdAt: "", updatedAt: "", name: "Somewhere", note: "hi" } } }, blobs: {}, kv: {}, schemaVersion: 1 }),
    );
  }, source);
  await page.goto("/?user=chrome");
  await expect(page.locator("h1")).toBeVisible();

  await page.locator(".k-list-row .k-list-text").first().click();
  await expect(page.locator(".k-detail")).toBeVisible();
  await page.locator(".k-detail-actions button", { hasText: "Pin Here" }).click();

  await expect(page.locator(".k-tab[data-active='true'] .k-tab-label")).toHaveText("Other");
});

test("a record can be deleted, and it asks first", async ({ page }) => {
  // `runtime.remove()` existed from the start but nothing in the UI ever called it: every app could
  // create records and never get rid of one.
  const native: string[] = [];
  page.on("dialog", (d) => { native.push(d.message()); void d.dismiss(); });

  await open(page);
  await expect(page.locator(".k-list-row")).toHaveCount(1);

  // Delete lives on the record's page, last in "More actions" (#111) — not on every row.
  const del = async (): Promise<void> => {
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
  };
  await page.locator(".k-list-row .k-list-text").first().click();
  await expect(page.locator(".k-detail")).toBeVisible();
  // Declining must keep the record — deletion is irreversible here.
  await del();
  const dialog = page.locator(".k-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Somewhere");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".k-detail")).toBeVisible();

  await del();
  await page.locator(".k-dialog").getByRole("button", { name: "Delete" }).click();
  // Back on the list, and the record is gone.
  await expect(page.locator(".k-list-row")).toHaveCount(0);

  // And it never reached for a platform dialog.
  expect(native, "a native browser dialog was used").toHaveLength(0);
});

test("row actions are labelled, not keyed", async ({ page }) => {
  // Same bug as the detail view had, in the other place actions are rendered: the button read
  // "startWorkout" rather than "Start Workout".
  await open(page);
  const labels = await page.locator(".k-row-actions button").allInnerTexts();
  expect(labels).toContain("Snap Photo");
  expect(labels).not.toContain("snapPhoto");
});
