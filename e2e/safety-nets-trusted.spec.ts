import { test, expect, type Page } from "./console-guard";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Safety nets for third-party code (#271), in a real browser.
//
//   1. The Add-an-app card never runs code: a package made by `pnpm pack:app` describes the app in its
//      manifest, so an app whose top level needs a web page — which the sealed box does not have (its
//      logic runs in a Worker, #272) — still shows its whole card, and installs. Without that description the card says it could not
//      preview the app; it never says the app "does not load".
//   2. A failure stays where it happens: an app with a computed value and a custom view that throw
//      opens, its other pages show their records, and the broken parts say so in plain words.
//   3. A test load at install: before an app from someone else is added, it is tried in the sealed
//      box with sample records, and what it reaches for that the box lacks is named on the card.

const PACK = fileURLToPath(new URL("../scripts/pack-app.mjs", import.meta.url));

// Sniffs for a browser the way many libraries do, then reads the page at the top level: fine where its
// author packs it (Node takes the other branch), a ReferenceError in the sealed box — a Worker, which
// has `self` but no page. (`Intl` used to be the example; the realm has it now, #272.)
const TOP_LEVEL_PAGE = `import { defineApp } from "potyro";
const lang = typeof self !== "undefined" ? document.documentElement.lang : "en";
const months = new Intl.DateTimeFormat(lang || "en", { month: "long" });
export default defineApp({
  id: "diary",
  name: "Diary",
  icon: "📓",
  version: "1.0.0",
  schemaVersion: 1,
  permissions: { notifications: true },
  entities: {
    entry: {
      label: "Entry",
      displayField: "title",
      fields: { title: { type: "text", required: true }, day: { type: "datetime" } },
      computed: { month: (e) => (e.day ? months.format(e.day) : "") },
    },
  },
  pages: [{ id: "all", title: "Entries", view: { type: "list", entity: "entry", display: { primary: "title", secondary: "month" } } }],
});
`;

// Reads the page only inside a computed value: it loads in the sealed box, and only running it shows the gap.
const COMPUTED_PAGE = `import { defineApp } from "potyro";
export default defineApp({
  id: "budget",
  name: "Budget",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    cost: {
      label: "Cost",
      displayField: "what",
      fields: { what: { type: "text", required: true }, amount: { type: "number" } },
      computed: { shown: (c) => new Intl.NumberFormat(document.documentElement.lang || "en", { style: "currency", currency: "EUR" }).format(c.amount ?? 0) },
    },
  },
  pages: [{ id: "all", title: "Costs", view: { type: "list", entity: "cost", display: { primary: "what", secondary: "shown" } } }],
});
`;

// One computed value and one custom view that throw, beside a page that works.
const PARTS_ID = "parts-app";
const PARTS = `import { defineApp } from "potyro";
export default defineApp({
  id: "${PARTS_ID}",
  name: "Parts",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    note: { label: "Note", displayField: "text", fields: { text: { type: "text", required: true } } },
    item: {
      label: "Item",
      displayField: "title",
      fields: { title: { type: "text", required: true } },
      computed: { month: () => { throw new Error("the month table is missing"); } },
    },
  },
  pages: [
    { id: "notes", title: "Notes", view: { type: "list", entity: "note", display: { primary: "text" } } },
    { id: "items", title: "Items", view: { type: "list", entity: "item", display: { primary: "title", secondary: "month" } } },
    { id: "chart", title: "Chart", view: { type: "custom", entity: "note", render: () => { throw new Error("the chart could not find its canvas"); } } },
  ],
});
`;

function packed(name: string, source: string): { name: string; mimeType: string; buffer: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), "safety-nets-"));
  writeFileSync(join(dir, `${name}.app.ts`), source);
  execFileSync("node", [PACK, `${name}.app.ts`, "-o", "out.zip"], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, stdio: "pipe" });
  return { name: `${name}.potyro-app.zip`, mimeType: "application/zip", buffer: readFileSync(join(dir, "out.zip")) };
}

async function openAdd(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function paste(page: Page, source: string) {
  const dialog = await openAdd(page);
  await dialog.getByRole("button", { name: /Paste the source/ }).click();
  await dialog.getByRole("textbox", { name: "The app's source" }).fill(source);
  await dialog.getByRole("button", { name: "Check it" }).click();
  return dialog;
}

test.use({ viewport: { width: 1280, height: 800 } });

test("a package whose top level throws in the sealed box shows its whole card from its manifest, and installs", async ({ page }) => {
  const dialog = await openAdd(page);
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles([packed("diary", TOP_LEVEL_PAGE)]);

  const card = dialog.getByRole("region", { name: "About Diary" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator(".k-launch-avatar")).toHaveText("📓");
  await expect(card).toContainText("KeepsEntry");
  await expect(card).toContainText("Asks fornotifications");
  await expect(card).toContainText("It uses a feature shared apps don’t have yet: a full web page (document). In the sealed box it will not open.");
  await expect(card.getByRole("button", { name: "Run it as my own app" })).toBeVisible();
  await expect(dialog).not.toContainText("does not load");

  await dialog.getByRole("button", { name: "Add app" }).click();
  // Added sealed, it would not open there: the card says so plainly and offers the way out (owner,
  // 2026-10-13) before anything opens.
  const after = dialog.getByRole("alert");
  await expect(after).toContainText("It only works when it runs as yours.", { timeout: 30_000 });
  await expect(after.getByRole("button", { name: "Let it run as yours" })).toBeVisible();
  await dialog.getByRole("button", { name: "Open Diary" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page).toHaveURL(/user=diary/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<{ id: string; trusted?: boolean }>);
  expect(saved.find((a) => a.id === "diary")).toMatchObject({ trusted: false });
});

test("the same app without a manifest: the card says it could not be previewed, never that it does not load, and offers to run it as yours", async ({ page }) => {
  const dialog = await paste(page, TOP_LEVEL_PAGE);
  const card = dialog.getByRole("region", { name: "About Diary" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("This app could not be previewed here");
  await expect(card).toContainText("a full web page (document)");
  await expect(dialog).not.toContainText("does not load");

  // Run as theirs, it is a whole app.
  await card.getByRole("button", { name: "Run it as my own app" }).click();
  await expect(dialog.getByRole("checkbox", { name: /I wrote this/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  await expect(page.locator("h1").first()).toHaveText("Diary");
});

test("an app from someone else is tried in the sealed box before it is added, and what it lacks there is named", async ({ page }) => {
  const dialog = await paste(page, COMPUTED_PAGE);
  const card = dialog.getByRole("region", { name: "About Budget" });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("KeepsCost");
  await expect(card).toContainText("It uses a feature shared apps don’t have yet: a full web page (document). In the sealed box, the parts of it that use it will not work.");
  await expect(dialog.getByRole("checkbox", { name: /I wrote this/ })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Add app" })).toBeEnabled();
});

test("a computed value and a custom view that throw fail alone: the app opens, its other pages show their records, the view that cannot show says so", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/the chart could not find its canvas|^The above error occurred in the <render> component/, "the app's custom view throws on purpose; React reports the contained error");
  await page.addInitScript(
    ([source, id]) => {
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id, name: "Parts", source, trusted: true, updatedAt: new Date().toISOString() }]));
    },
    [PARTS, PARTS_ID],
  );
  await page.goto(`/?user=${PARTS_ID}`);
  await expect(page.locator("h1").first()).toHaveText("Parts", { timeout: 30_000 });
  const nav = (title: string) => page.locator(".k-sidenav .k-tab", { hasText: title }).click();

  await page.getByRole("button", { name: "Add: Note" }).click();
  await page.getByLabel("Text").fill("Buy milk");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".k-list-row")).toContainText("Buy milk");

  // The broken computed: the record is there, its value is empty, and nothing alerts over the list —
  // the person using the app cannot fix the app's code, and the list still works.
  await nav("Items");
  await page.getByRole("button", { name: "Add: Item" }).click();
  await page.getByLabel("Title").fill("First item");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".k-list-row")).toContainText("First item");
  await expect(page.locator(".k-list-row")).not.toContainText("month table");
  await expect(page.locator(".k-part-problem")).toHaveCount(0);

  // The broken custom view: its part says so, and the app around it is still there.
  await nav("Chart");
  await expect(page.locator(".k-part-problem")).toHaveText("This part of the app hit a problem: it could not be shown: the chart could not find its canvas");
  await expect(page.locator(".k-view-crash")).toHaveCount(0);
  await expect(page.locator("h1").first()).toHaveText("Parts");

  // And the page that works still works.
  await nav("Notes");
  await expect(page.locator(".k-list-row")).toContainText("Buy milk");
  await expect(page.locator(".k-part-problem")).toHaveCount(0);
});
