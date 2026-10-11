import { test, expect } from "@playwright/test";

// THE PATH `fix-this-trusted.spec.ts` DELIBERATELY DODGES, exercised directly. That spec's header
// comment explains why its broken action calls `ctx.navigate("map")` immediately followed by
// `ctx.navigate("all")`: a single missing-page navigate crashes the whole React tree to a blank
// `#root` — no error boundary existed anywhere in `packages/` to catch it — and a spec that needs to
// keep driving the browser afterwards cannot let that happen mid-test. This spec is the other half:
// prove that single navigate no longer takes the shell down. `ViewErrorBoundary` (packages/shell/src/
// view-error-boundary.tsx), wrapped around the page-content region in App.tsx, is what changed —
// without it this test fails the same way the throwaway probe in fix-this-trusted.spec.ts's header
// comment describes: a blank page, no header, no "Something's wrong" button, nothing to click.
const APP_ID = "towns-app";
const APP_NAME = "Towns";

const BROKEN_SOURCE = `import { defineApp } from "potyro";

export default defineApp({
  id: "${APP_ID}",
  name: "${APP_NAME}",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    town: {
      label: "Town",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
      },
      actions: {
        openMissing: (record, ctx) => {
          ctx.navigate("nowhere");
        },
      },
    },
  },
  pages: [
    {
      id: "all",
      title: "Towns",
      view: {
        type: "list",
        entity: "town",
        display: { primary: "name" },
        rowActions: ["openMissing"],
      },
    },
  ],
});
`;

test.beforeEach(async ({ page }) => {
  // Seeded straight into "My Apps", the same technique fix-this-trusted.spec.ts uses — what matters
  // is that it is a saved app with a real id, not how it got saved.
  await page.addInitScript(
    ([source, id, name]) => {
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id, name, source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [BROKEN_SOURCE, APP_ID, APP_NAME],
  );
});

test("navigating to a missing page crashes only the view — the shell and the recorder survive", async ({ page }) => {
  await page.goto(`/?user=${APP_ID}`);
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);

  // Create a record so there is a row to trigger the crashing action from.
  await page.getByRole("button", { name: "New Town" }).click();
  await page.getByLabel("Name").fill("Springfield");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".k-list-row")).toBeVisible();

  // The crash: a single `ctx.navigate` naming a page this app never declared. Before the boundary,
  // this unmounted the whole tree — no header, no nav, no recorder, just a blank #root.
  await page.getByRole("button", { name: "Open Missing" }).click();

  // The fallback replaces only the view — it says what broke and names the error, not a silent
  // blank panel.
  const crash = page.locator(".k-view-crash");
  await expect(crash).toBeVisible();
  await expect(crash).toContainText(/couldn.t be shown/);
  await expect(crash).toContainText(/nowhere/);

  // THE POINT: everything around the crash is still there and still usable. Header, brand, nav —
  // the chrome the crash must not take down.
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);
  await expect(page.getByRole("button", { name: "Towns" })).toBeVisible();

  // Above all: the "Something's wrong" recorder — the control this whole feature exists to keep
  // reachable — still works. Started here, on the very page that just crashed, proving the crash
  // did not take the recorder down with it. (Nothing to actually replay — the crash happened before
  // recording started — so this only proves the control itself is alive, not a full report.)
  await page.getByRole("button", { name: "Something's wrong" }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await page.getByRole("button", { name: "Stop recording" }).click();
  // Stopping now ASKS for the expectation first (App.tsx's `onStopRecording`): a case whose title is
  // always "" has nothing for an agent to work from without a note, so it is collected at the
  // moment the person is still here rather than refused later. Seeing that prompt is itself proof
  // the recorder is alive on the page that just crashed, which is all this test needs — there is
  // nothing to replay, since the crash happened before recording began. Cancel abandons the stop.
  await expect(page.getByRole("textbox", { name: /what did you expect/i })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  // Recovery: the fallback's own button gets you back to a page that actually works, no reload
  // required — the list view renders again, with the record created earlier still there.
  await crash.getByRole("button", { name: "Back to a working page" }).click();
  await expect(page.locator(".k-view-crash")).toHaveCount(0);
  await expect(page.locator(".k-list-row")).toContainText("Springfield");
});
