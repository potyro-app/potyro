import { test, expect } from "@playwright/test";
import { currentCard, openNewStudio, openSource } from "./studio-helpers.js";

// The Studio's History tab surfaces cases reported against a SAVED app (app-cases.ts: `listCases`
// filters by `appId`, and cases only mean anything once an app has an id to hang them on). This
// drives the whole loop through the real UI, with no model call and no network:
//
//   1. Author an app by hand in the Source tab (no AI) and save it to My Apps — that gives it the
//      id cases are keyed by.
//   2. Open it as a real app (`?user=<id>`, exactly what the Launcher does) and RECORD a case the
//      way a person would: create a record, follow a declared navigation action to another page,
//      write down what was expected, stop.
//   3. Back in the Studio, edit the SAME app's source to remove the page the recording visited —
//      the ordinary shape of "the app changed since the report came in" — and save that as a new
//      version.
//   4. Open the History tab and replay the case against the now-different app.
//
// That one replay proves the two things the feature exists for: it reads back the reporter's own
// words, and it catches the app that now has fewer pages than the case remembers — reporting the
// exact step that goes nowhere, by name, not just "something failed" (replay.ts's whole point).

const APP_NAME = "Case Test App";

const SOURCE_V1 = `import { defineApp } from "potyro";

export default defineApp({
  id: "case-test-app",
  name: "${APP_NAME}",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
      },
    },
  },
  pages: [
    { id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } },
    {
      id: "detail",
      title: "Item",
      view: {
        type: "detail",
        entity: "item",
        param: "id",
        sections: [{ fields: ["title"] }],
        actions: [{ label: "Back to items", navigate: { page: "all" } }],
      },
    },
  ],
});
`;

// V2 drops the "detail" page entirely — the app someone reports a case against is never the last
// version of that app forever; this is what a normal edit looks like.
const SOURCE_V2 = `import { defineApp } from "potyro";

export default defineApp({
  id: "case-test-app",
  name: "${APP_NAME}",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
      },
    },
  },
  pages: [
    { id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } },
  ],
});
`;

const EXPECTATION = "I expected the detail page to still be there after the app changed";

test("a case recorded against a saved app shows up in Studio history and its replay names the page the app lost", async ({
  page,
}) => {
  // --- 1. Author + save an app by hand, no model call -------------------------------------------
  // From the home screen: a Studio opened there is for making a new app. Opened from inside an app
  // it is for changing THAT app, and opens on it (reported 2026-09-13).
  const studio = await openNewStudio(page);
  const tools = await openSource(page, studio);
  await tools.getByRole("textbox", { name: "App source" }).fill(SOURCE_V1);
  await tools.getByRole("button", { name: "Save changes" }).click();
  // Saved as an app: its card is in the conversation.
  await expect(currentCard(studio).locator(".k-card-name")).toContainText(APP_NAME, { timeout: 30_000 });

  // Read back the id the UI actually assigned — not assumed from the slugging rule — so the rest of
  // the test drives the exact record the app just created.
  const appId = await page.evaluate(() => {
    const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<{ id: string; name: string }>;
    return apps.find((a) => a.name === "Case Test App")?.id ?? null;
  });
  expect(appId).toBeTruthy();

  // --- 2. Record a real case against the saved app, through the app itself ----------------------
  await page.goto(`/?user=${appId}`);
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);

  await page.getByRole("button", { name: "Something's wrong" }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();

  // Create a record — the auto quick action opens the create form, and finishing it navigates to
  // the record's detail page. That navigation is what the recorder captures as an "open" step.
  await page.getByRole("button", { name: "New Item" }).click();
  await page.getByLabel("Title").fill("Widget");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".k-detail")).toBeVisible();

  // Follow the app's own declared navigation back to the list — a SECOND real "open" step, this
  // time for the page that survives into v2.
  await page.getByRole("button", { name: "Back to items" }).click();
  await expect(page.locator(".k-list")).toBeVisible();

  await page.getByRole("button", { name: "Add a note" }).click();
  await page.getByRole("textbox", { name: "What did you expect?" }).fill(EXPECTATION);
  await page.getByRole("button", { name: "Save note" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();

  // Stopping replays immediately against the still-current app and shows its own report — close it,
  // the report this test cares about is the one Studio produces after the app has changed.
  const liveReport = page.locator(".k-case-report");
  await expect(liveReport).toBeVisible();
  await liveReport.getByRole("button", { name: "Close" }).click();

  // --- 3. Evolve the SAME app: drop the page the case visited -------------------------------------
  await page.getByRole("button", { name: "Studio" }).click();
  const studio2 = page.locator(".k-studio");
  await expect(studio2).toBeVisible();
  // Opened from inside the app, the Studio is already on it — no detour through the starter and My
  // Apps, which is the workaround this step used to need.
  await expect(studio2.locator(".k-studio-preview h1").first()).toHaveText(APP_NAME, { timeout: 30_000 });
  await expect(studio2.locator(".k-studio-name")).toHaveText(APP_NAME);

  const tools2 = await openSource(page, studio2);
  await tools2.getByRole("textbox", { name: "App source" }).fill(SOURCE_V2);
  await tools2.getByRole("button", { name: "Save changes" }).click();
  await expect(currentCard(studio2).locator(".k-card-seq")).toHaveText("v2", { timeout: 30_000 });

  // --- 4. The case is in History, and replay tells the truth about the app it is against now ------
  await tools2.getByRole("tab", { name: "History" }).click();
  const casesSection = studio2.locator(".k-cases-section");
  await expect(casesSection).toBeVisible();
  await expect(casesSection.locator(".k-case-title")).toHaveText(EXPECTATION); // caseLabel() falls back to the expect note

  await casesSection.getByRole("button", { name: "Replay" }).click();
  const report = studio2.locator(".k-case-report");
  await expect(report).toBeVisible();

  // The user's own words lead the report.
  await expect(report).toContainText(EXPECTATION);

  // Every recorded step produced an outcome.
  const steps = report.locator(".k-case-step");
  await expect(steps).toHaveCount(3); // open "detail" (now missing), open "all", the expectation note

  // The step for the page that still exists succeeded.
  await expect(report.locator('.k-case-step[data-ok="true"]').first()).toContainText('opened "all"');

  // The step for the page the app no longer has is reported as a FAILURE that names the missing
  // page and what the app has instead — not just "something went wrong". This is the whole point
  // of replay (replay.ts's own comment: catching an app that "compiles, validates, renders" and
  // still opens a page that does not exist).
  const failed = report.locator('.k-case-step[data-ok="false"]');
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText('no page "detail" in this app');
  await expect(failed).toContainText("it has: all");
});
