import { test, expect, type Page } from "@playwright/test";

// The recovery promise, end to end: make an app, put real notes in it, change it twice, and get back.
//
// Every other test of this covers one link. `history-trusted.spec.ts` proves a hand edit is diffable
// and reversible against an app with NO DATA IN IT, which is the easy half — a rollback that loses
// every record still passes it. `app-update-trusted.spec.ts` proves migrations run. Nothing joined
// them up, and the join is the actual product claim: *change your app as often as you like, because
// you can always see what changed and go back, and your notes are still there.*
//
// So this drives the whole chain in a browser — Studio generate → save → records → modify → save →
// modify → save → History → restore → restore forward — and checks the records after every step.
//
// It must FAIL if history keeps only the final source, or if a rollback drops data.
//
// ## No model, on purpose
//
// The generator endpoint is stubbed with three canned sources. That is not to make the test cheap
// (although it is): a model would make the app under test different on every run, and a rollback
// suite whose fixtures change underneath it cannot tell a product regression from a model having a
// different idea that morning. What is being measured here is the shell's version log and its
// migrations, and neither of those gets better or worse when a model writes the source.

const APP_ID = "field-notes"; // slug of the app NAME — see `saveUserApp`

const app = (opts: { version: string; title: string; fields: string; migrations?: string }): string =>
  `import { defineApp } from "potyro";

export default defineApp({
  id: "field-notes",
  name: "Field Notes",
  version: "${opts.version}",
  schemaVersion: 1,
  entities: {
    note: {
      label: "Note",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        body: { type: "text" },
${opts.fields}      },
    },
  },
  pages: [
    { id: "all", title: "${opts.title}", view: { type: "list", entity: "note", display: { primary: "title", secondary: "body" } } },
  ],${opts.migrations ? `\n  migrations: ${opts.migrations},` : ""}
});
`;

/** What the model "returns" for the initial description. */
const V1 = app({ version: "1.0.0", title: "Notes", fields: "" });
/** Modification 1: a tag field, with the migration that carries existing notes across. */
const V2 = app({
  version: "1.1.0",
  title: "Notes & tags",
  fields: `        tag: { type: "text" },\n`,
  migrations: `[{ from: "1.0.0", to: "1.1.0", steps: [{ op: "addField", entity: "note", field: "tag", default: "" }] }]`,
});
/** Modification 2: pinning, on top of whatever modification 1 produced. */
const V3 = app({
  version: "1.2.0",
  title: "Pinned first",
  fields: `        tag: { type: "text" },\n        pinned: { type: "boolean", default: false },\n`,
  migrations:
    `[{ from: "1.0.0", to: "1.1.0", steps: [{ op: "addField", entity: "note", field: "tag", default: "" }] },\n` +
    `    { from: "1.1.0", to: "1.2.0", steps: [{ op: "addField", entity: "note", field: "pinned", default: false }] }]`,
});

const MOD_1 = "let me tag a note";
const MOD_2 = "let me pin a note to the top";

const NOTES = [
  { title: "Kingfisher", body: "seen at the weir, just after seven" },
  { title: "Otter tracks", body: "north bank, near the alders" },
];

/**
 * Stand in for the dev server's `claude -p` endpoint, handing out canned sources in order.
 *
 * The Studio's real client is exercised unchanged — POST to start a job, GET to poll it — because
 * the thing under test includes the Studio believing it generated an app.
 */
async function stubGenerator(page: Page, sources: string[]): Promise<{ calls: () => number }> {
  const queue = [...sources];
  const jobs = new Map<string, string>();
  let served = 0;

  await page.route("**/__generate**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const source = queue.shift();
      if (source === undefined) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "the stub is out of sources" }) });
      }
      const id = `job-${++served}`;
      jobs.set(id, source);
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id }) });
    }
    const id = new URL(request.url()).searchParams.get("id") ?? "";
    const source = jobs.get(id);
    if (source === undefined) {
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "unknown job" }) });
    }
    jobs.delete(id);
    // Fenced, like a model's reply — `extractSource` unwrapping it is part of the path.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "done", text: "```ts\n" + source + "```\n" }),
    });
  });

  return { calls: () => served };
}

const studioOf = (page: Page) => page.locator(".k-studio");

/** A page's tab in the running app. Rendered as a tab or a button depending on how many there are. */
const pageTab = (scope: ReturnType<typeof studioOf> | Page, title: string) =>
  scope.getByRole("tab", { name: title }).or(scope.getByRole("button", { name: title })).first();

async function openStudio(page: Page): Promise<void> {
  // `exact`, because the Studio's own header carries a "Close studio" button and a substring match
  // finds both the moment it is already open.
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(studioOf(page)).toBeVisible();
}

/**
 * Ask the Studio for a change and wait for it to be kept as the version `seq`, with the page title
 * it was meant to produce in the saved source. (The preview beside the conversation is narrow enough
 * to wear the phone chrome, where a one-page app shows no page tab — so the source is what is read;
 * `expectNotesIntact` checks the tab on the running app.)
 */
async function askFor(page: Page, instruction: string, expectTitle: string, seq: string): Promise<void> {
  const studio = studioOf(page);
  await studio.getByRole("textbox", { name: "Describe the app" }).fill(instruction);
  await studio.getByRole("button", { name: /Modify the app/ }).click();
  await kept(page, seq);
  expect(await storedSource(page)).toContain(`title: ${JSON.stringify(expectTitle)}`);
}

const storedSource = (page: Page): Promise<string> =>
  page.evaluate((id: string) => {
    const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as { id: string; source: string }[];
    return apps.find((a) => a.id === id)?.source ?? "";
  }, APP_ID);

/** Add a note through the app's own generated form. */
async function addNote(page: Page, note: { title: string; body: string }): Promise<void> {
  await page.locator(".k-quickbar").getByRole("button", { name: /Add: Note/ }).click();
  const modal = page.locator(".k-modal");
  await expect(modal).toBeVisible();
  await modal.getByRole("textbox").nth(0).fill(note.title);
  await modal.getByRole("textbox").nth(1).fill(note.body);
  await modal.getByRole("button", { name: "Create" }).click();
  await expect(modal).toHaveCount(0);
}

/** Both notes, with the words the user typed, on the running app. The claim the whole test is for. */
async function expectNotesIntact(page: Page, pageTitle: string): Promise<void> {
  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator("h1").first()).toHaveText("Field Notes", { timeout: 30_000 });
  await expect(pageTab(page, pageTitle)).toBeVisible({ timeout: 30_000 });
  for (const note of NOTES) {
    const row = page.locator(".k-list-row", { hasText: note.title });
    await expect(row).toBeVisible({ timeout: 30_000 });
    // Not just the row: the SECONDARY line, which is the field a migration is most likely to lose.
    await expect(row).toContainText(note.body);
  }
}

/**
 * The version log, wherever it lives.
 *
 * In the Studio it is behind the menu, in the code-and-history sheet (#261); a restore closes the
 * sheet and drops you back on the conversation, with the app beside it. The markup underneath is the
 * same `<History>` the modal renders (see `history-trusted.spec.ts`), so every assertion below reads
 * identically; only the way in and the way out differ.
 */
const timeline = (page: Page) => studioOf(page).locator(".k-studio-history");

/** One line of the open diff. These changes touch several lines, so the line itself is the assertion. */
const diffLine = (page: Page, kind: "add" | "del", text: string) =>
  timeline(page).locator(`.k-diff-${kind}`).filter({ hasText: text });
const entry = (page: Page, seq: string) =>
  timeline(page).locator(".k-timeline-entry").filter({ has: page.locator(".k-history-seq", { hasText: seq }) });

async function openHistory(page: Page): Promise<void> {
  await studioOf(page).getByRole("button", { name: "Studio menu" }).click();
  await page.getByRole("menuitem", { name: "History" }).click();
  await expect(timeline(page)).toBeVisible();
}

/** Leave the timeline the way a person does: close the sheet. */
async function closeHistory(page: Page): Promise<void> {
  await studioOf(page).getByRole("button", { name: "Close code and history" }).click();
  await expect(timeline(page)).toHaveCount(0);
}

/**
 * Wait until a change has been KEPT.
 *
 * Every version is saved as it is made (#261), and its card is the product's own word that it is
 * done: the card appears after the version is written, so navigating away from here cannot outrun
 * the write — the thing a person waits for too.
 */
async function kept(page: Page, seq: string): Promise<void> {
  await expect(studioOf(page).locator(".k-card[data-current] .k-card-seq")).toHaveText(seq, { timeout: 30_000 });
}

/** Open a saved app in the Studio, so `currentId` is set and History/Save changes apply to it. */
async function reopenInStudio(page: Page): Promise<void> {
  // Opened from inside the app, the Studio is already on it, with the app beside the conversation.
  await openStudio(page);
  await expect(studioOf(page).locator(".k-studio-name")).toHaveText("Field Notes");
  await expect(studioOf(page).locator(".k-studio-preview h1").first()).toHaveText("Field Notes", { timeout: 30_000 });
}

test.describe("create, change twice, and get back", () => {
  test.setTimeout(180_000);

  test("history keeps every version, and a rollback keeps every note", async ({ page }) => {
    const generator = await stubGenerator(page, [V1, V2, V3]);
    // From the home screen, so the Studio opens for a new app rather than on the one in view.
    await page.goto("/");

    // ---- 1. make an app in the Studio and save it -------------------------------------------
    // Home's "New app" tile is the Studio's way in for a new app.
    await page.getByRole("button", { name: /New app/ }).click();
    await expect(studioOf(page)).toBeVisible();
    const studio = studioOf(page);
    await studio.getByRole("textbox", { name: "Describe the app" }).fill("somewhere to keep field notes");
    // One action button, not one button per engine: `claude -p` is the default engine and is named
    // on the Model settings button beside it, so there is nothing to choose here.
    await studio.getByRole("button", { name: /Create the app/ }).click();
    // Saved as it is made — its card says so, and the app opens beside the conversation.
    await kept(page, "v1");
    await expect(studio.locator(".k-studio-preview h1").first()).toHaveText("Field Notes", { timeout: 60_000 });

    // ---- 2. put two distinguishable notes in it ---------------------------------------------
    await page.goto(`/?user=${APP_ID}`);
    await expect(page.locator("h1").first()).toHaveText("Field Notes", { timeout: 30_000 });
    for (const note of NOTES) await addNote(page, note);
    await expectNotesIntact(page, "Notes");

    // ---- 3. two source-changing modifications, through the product path ----------------------
    await reopenInStudio(page);
    await askFor(page, MOD_1, "Notes & tags", "v2");
    await askFor(page, MOD_2, "Pinned first", "v3");
    expect(generator.calls(), "one call to generate, one per modification").toBe(3);

    // Both migrations run on the real app, and both notes come through them.
    await expectNotesIntact(page, "Pinned first");

    // ---- 4. both prompts are in History, each with a diff ------------------------------------
    await reopenInStudio(page);
    await openHistory(page);
    for (const seq of ["v1", "v2", "v3"]) await expect(entry(page, seq)).toBeVisible({ timeout: 30_000 });
    // The prompt is the headline — this is what somebody recognises their own change by, and it is
    // the assertion that fails if history ever keeps only the final source.
    await expect(entry(page, "v2").locator(".k-timeline-note")).toContainText(MOD_1);
    await expect(entry(page, "v3").locator(".k-timeline-note")).toContainText(MOD_2);

    await entry(page, "v3").getByRole("button").first().click();
    await expect(diffLine(page, "add", 'title: "Pinned first"')).toHaveCount(1);
    await expect(diffLine(page, "del", 'title: "Notes & tags"')).toHaveCount(1);
    await entry(page, "v3").getByRole("button").first().click(); // close it again

    await entry(page, "v2").getByRole("button").first().click();
    await expect(diffLine(page, "add", 'title: "Notes & tags"')).toHaveCount(1);
    await expect(diffLine(page, "del", 'title: "Notes"')).toHaveCount(1);

    // ---- 5. restore the source from BEFORE the second modification ---------------------------
    await timeline(page).getByRole("button", { name: "Restore v2" }).click();
    await expect(timeline(page)).toHaveCount(0);
    await expect(studio.locator(".k-thread-event", { hasText: "rolled back to version 2" })).toBeVisible({ timeout: 30_000 });

    const stored = await page.evaluate((id: string) => {
      const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as { id: string; source: string }[];
      return apps.find((a) => a.id === id)?.source ?? "";
    }, APP_ID);
    expect(stored).toContain('title: "Notes & tags"');
    expect(stored).not.toContain('title: "Pinned first"');

    // ---- 6. the rollback is itself a version, so it is itself reversible ---------------------
    await openHistory(page);
    await expect(entry(page, "v4")).toBeVisible({ timeout: 30_000 });
    await expect(entry(page, "v4").locator(".k-history-origin")).toHaveText("restored");
    // Nothing was truncated: the version we rolled back FROM is still there to roll forward to.
    await expect(entry(page, "v3")).toBeVisible();
    await closeHistory(page);

    // ---- 7. the notes survived the rollback --------------------------------------------------
    await expectNotesIntact(page, "Notes & tags");

    // ---- 8. and forward again: recovery is reversible in both directions ---------------------
    await reopenInStudio(page);
    await openHistory(page);
    await entry(page, "v3").getByRole("button").first().click();
    await timeline(page).getByRole("button", { name: "Restore v3" }).click();
    await expect(timeline(page)).toHaveCount(0);
    await expect(studio.locator(".k-thread-event", { hasText: "rolled back to version 3" })).toBeVisible({ timeout: 30_000 });
    expect(await storedSource(page)).toContain('title: "Pinned first"');

    // The Studio is still open on the restored app — no need to reopen it.
    await openHistory(page);
    await expect(entry(page, "v5")).toBeVisible({ timeout: 30_000 });
    await expect(entry(page, "v5").locator(".k-history-origin")).toHaveText("restored");
    await closeHistory(page);

    // The re-applied migration runs against data that has already seen it once, and the notes are
    // still the notes.
    await expectNotesIntact(page, "Pinned first");
  });
});
