import { test, expect, type Page, type Route } from "@playwright/test";
import { openSource } from "./studio-helpers.js";

// The whole loop, with the model stubbed: a recorded failing path, an agent that investigates and
// proposes, verification against the user's own recording, and an applied fix that lands in
// history. Task 5 closes the loop task-4 left open — everything up to "Fix this" already worked;
// this is the missing last step, accepting a verified fix so it becomes the person's app.
//
// THE BUG, and why it is shaped this way: "I clicked a city, I expected the map to open" is an
// entity action whose FIRST `ctx.navigate` call names a page ("map") the app never declares. A view
// that actually RENDERS a missing page throws synchronously in `getView` (packages/views/src/
// format.ts) with no error boundary above it anywhere in this tree, and the WHOLE app unmounts to a
// blank `#root` — confirmed by hand with a throwaway probe before writing this spec. So the action
// calls `ctx.navigate("map")` immediately followed by `ctx.navigate("all")` (a real page): both
// calls happen synchronously, so CaseRecorder's `wrapNav` (case-recorder.ts) captures BOTH as `open`
// steps — including the one naming the missing page — while React's batching means only the second,
// valid navigation is ever actually rendered. The case genuinely captures the bug; the browser never
// touches the page that doesn't exist. This is what makes an in-browser recording of "onOpen names a
// missing page" possible at all without crashing the very page the test is driving.
const APP_ID = "cities-app";
const APP_NAME = "Cities";

const BROKEN_SOURCE = `import { defineApp } from "potyro";

export default defineApp({
  id: "${APP_ID}",
  name: "${APP_NAME}",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    city: {
      label: "City",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
      },
      actions: {
        openMap: (record, ctx) => {
          ctx.navigate("map");
          ctx.navigate("all");
        },
      },
    },
  },
  pages: [
    {
      id: "all",
      title: "Cities",
      view: {
        type: "list",
        entity: "city",
        display: { primary: "name" },
        rowActions: ["openMap"],
      },
    },
  ],
});
`;

// The agent's fix: give the action the page it was already trying to reach. Nothing else changes —
// the test asserts the app was fixed, not replaced.
const FIXED_SOURCE = `import { defineApp } from "potyro";

export default defineApp({
  id: "${APP_ID}",
  name: "${APP_NAME}",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    city: {
      label: "City",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
      },
      actions: {
        openMap: (record, ctx) => {
          ctx.navigate("map");
          ctx.navigate("all");
        },
      },
    },
  },
  pages: [
    {
      id: "all",
      title: "Cities",
      view: {
        type: "list",
        entity: "city",
        display: { primary: "name" },
        rowActions: ["openMap"],
      },
    },
    {
      id: "map",
      title: "Map",
      view: {
        type: "list",
        entity: "city",
        display: { primary: "name" },
      },
    },
  ],
});
`;

const EXPECTATION = "I clicked a city and expected the map to open";

test.beforeEach(async ({ page }) => {
  // Seeded straight into "My Apps" (the same technique edit-mode-trusted.spec.ts uses) rather than
  // authored through the Studio — what matters for this test is that it is a SAVED app with a real
  // id cases and history hang off of, not how it got saved.
  //
  // `addInitScript` re-runs on EVERY navigation in this page, not just the first — including the
  // `location.reload()` `applyFix` does after a successful Apply. Guarded on "nothing there yet" so
  // it seeds the broken app once and then gets out of the way; without the guard it would silently
  // re-seed the ORIGINAL broken source over the applied fix on that very reload, and the back half
  // of this test would be asserting against a fix that never actually landed.
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

/** Pick the one engine that can drive the investigate loop (engines.ts: canInvestigate) — the SAME
 *  picker App.tsx's "Fix this" gate reads (engine-store.ts), reached the same way a person reaches
 *  it: through the Studio's Model settings. Assumes the app is already open (`?user=<id>`). */
async function chooseOpenRouter(page: Page): Promise<void> {
  await expect(page.locator("h1").first()).toHaveText(APP_NAME);
  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio).toBeVisible();
  await studio.getByRole("button", { name: "Model settings" }).click();
  const settings = page.getByRole("dialog", { name: "Model settings" });
  await settings.getByRole("radio", { name: /OpenRouter/ }).check();
  await settings.getByLabel("OpenRouter API key").fill("sk-or-stub");
  await settings.getByRole("button", { name: "Close model settings" }).click();
  await studio.getByRole("button", { name: "Close studio" }).click();
}

/** Record the failing path, the way a person would: create a city, trigger the row action whose
 *  first navigate names the missing page (see the file header for why this never touches the
 *  missing page live), note the expectation, stop. Leaves `.k-case-report` on screen. */
async function recordTheCase(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Something's wrong" }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();

  await page.getByRole("button", { name: "Add: City" }).click();
  await page.getByLabel("Name").fill("Paris");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".k-list-row")).toBeVisible();

  await page.getByRole("button", { name: "Open Map" }).click();

  await page.getByRole("button", { name: "Add a note" }).click();
  await page.getByRole("textbox", { name: "What did you expect?" }).fill(EXPECTATION);
  await page.getByRole("button", { name: "Save note" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator(".k-case-report")).toBeVisible();
}

test("a reported problem is investigated, verified and applied", async ({ page }) => {
  // Stub OpenRouter: first turn calls replay_case, second returns a corrected app.
  let turn = 0;
  await page.route("**/openrouter.ai/**", async (route) => {
    turn += 1;
    const body =
      turn === 1
        ? {
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [{ id: "t1", type: "function", function: { name: "replay_case", arguments: "{}" } }],
                },
              },
            ],
          }
        : {
            choices: [
              {
                message: {
                  content:
                    'Added the "map" page — the action was already trying to reach it.\n```ts\n' +
                    FIXED_SOURCE +
                    "\n```",
                },
              },
            ],
          };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto(`/?user=${APP_ID}`);
  await chooseOpenRouter(page);
  await recordTheCase(page);

  // Stopping replays immediately, against the app as it is right now — proof the recording actually
  // captured the bug, not just some steps. Left open (not closed): closing it would also unmount the
  // "Fix this" entry point, which is a sibling under the same `caseReport` state in App.tsx.
  const liveReport = page.locator(".k-case-report");
  await expect(liveReport).toBeVisible();
  await expect(liveReport).toContainText('no page "map" in this app');

  // Fix this: investigate, verify against the recording, and watch the step feed.
  await page.getByRole("button", { name: "Fix this" }).click();
  const fixPanel = page.getByRole("dialog", { name: "Fix this" });
  await expect(fixPanel).toBeVisible();

  // The step feed shows the tool call the stub answered on turn 1, and that it (correctly) found the
  // recorded case still failing against the app as it stands.
  const toolStep = fixPanel.locator('[data-kind="tool"]');
  await expect(toolStep).toContainText("replay_case", { timeout: 15_000 });
  await expect(toolStep).toHaveAttribute("data-ok", "false");

  // The outcome offers Apply — the ONE candidate that replayed the user's own case and passed
  // (fix-panel.tsx's whole reason to exist: `lastAttempt` on any other outcome never gets this).
  const outcome = fixPanel.locator('[data-kind="fix"]');
  await expect(outcome).toBeVisible({ timeout: 15_000 });
  await expect(outcome).toContainText(/map/i);
  await outcome.getByRole("button", { name: "Apply" }).click();

  // Applying reloads with the fixed source running — the same "re-run the app" contract every other
  // source-changing path in App.tsx follows (applyModify, applyStructuralEdit, setTrust).
  await expect(page.locator("h1").first()).toHaveText(APP_NAME, { timeout: 30_000 });

  // The Studio's code shows the corrected app, not a reprompt or a placeholder. Opened from the app,
  // the Studio is on its saved, CURRENT source.
  await page.getByRole("button", { name: "Studio" }).click();
  const studio2 = page.locator(".k-studio");
  await expect(studio2).toBeVisible();
  await expect(studio2.locator(".k-studio-preview h1").first()).toHaveText(APP_NAME, { timeout: 30_000 });
  const tools = await openSource(page, studio2);
  const source = await tools.getByRole("textbox", { name: "App source" }).inputValue();
  expect(source).toContain('id: "map"'); // the page the action was missing now exists
  expect(source).toContain(`id: "${APP_ID}"`); // the app was fixed, not replaced
  await tools.getByRole("button", { name: "Close code and history" }).click();
  await studio2.getByRole("button", { name: "Close studio" }).click();

  // History shows a version whose note names the CASE — the person's own recorded expectation, not
  // a generic "AI fix" (app-cases.ts's `caseLabel`, shared by Studio's case list and this).
  await page.getByRole("button", { name: "History" }).click();
  const timeline = page.locator(".k-timeline");
  await expect(timeline).toBeVisible();
  await expect(timeline).toContainText(EXPECTATION);
});

// The race p2b-task-4-fixes-report.md describes but couldn't test at the time (no controllable
// model harness existed yet): press Stop/Close and immediately press "Fix this" again — no unusual
// timing needed, just an impatient second click — and a run that SHOULD be dead can still write into
// the panel the new run owns. App.tsx's `fixRunId` (bumped by `openFix`, checked by both `onStep` and
// the `.then(setFixOutcome)` in `runFix`) is the guard under test; nothing here touches it.
//
// The stubbed OpenRouter route is what makes this timeable at all: run 1's SECOND request is held
// open (never fulfilled) until the test explicitly releases it — well after run 2 has already
// finished — so "run 1's promise settles late" isn't a hope, it's controlled directly.
test("a superseded run cannot overwrite the run that replaced it", async ({ page }) => {
  const RUN1_LATE = "RUN1-LATE-MUST-NEVER-REACH-THE-SCREEN";
  const RUN2_DIAGNOSIS = "RUN2-DIAGNOSIS-IS-THE-ONLY-ONE-THAT-SHOULD-SHOW";

  let callIndex = 0;
  let holdRoute: Route | null = null;
  let resolveHeld: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    resolveHeld = resolve;
  });

  await page.route("**/openrouter.ai/**", async (route) => {
    callIndex += 1;
    if (callIndex === 1) {
      // Run 1, turn 1: a real tool call, so the panel shows a genuine step before this run is
      // superseded — not just an empty "thinking" that could pass by coincidence.
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [
            { message: { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "replay_case", arguments: "{}" } }] } },
          ],
        }),
      });
      return;
    }
    if (callIndex === 2) {
      // Run 1, turn 2 — held open deliberately, never fulfilled here. The test releases it later,
      // on purpose, after run 2 has already finished: that ordering is the entire point.
      holdRoute = route;
      resolveHeld?.();
      return;
    }
    // Run 2's only turn — answered immediately, so it finishes while run 1's turn 2 is still held.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: `NOT-IN-APP: ${RUN2_DIAGNOSIS}` } }] }),
    });
  });

  await page.goto(`/?user=${APP_ID}`);
  await chooseOpenRouter(page);
  await recordTheCase(page);

  // Run 1: start it, let its first turn's tool call actually land, then wait until its SECOND
  // request is genuinely in flight (not merely "sent" — `held` only resolves once our route handler
  // has received it) before superseding it.
  await page.getByRole("button", { name: "Fix this" }).click();
  const fixPanel = page.getByRole("dialog", { name: "Fix this" });
  await expect(fixPanel.locator('[data-kind="tool"]')).toContainText("replay_case", { timeout: 15_000 });
  await held;

  // Supersede it: Close (which aborts AND resets `fixOpen`, the only thing gating the button — see
  // App.tsx's `closeFix`), then Fix this again. This is the exact impatient-click scenario Finding 1
  // in p2b-task-4-fixes-report.md describes.
  await fixPanel.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Fix this" }).click();

  // Run 2 finishes completely — its one turn was answered immediately — while run 1's second turn is
  // STILL held open. If the guard were missing there would be nothing to distinguish this from run 1
  // eventually finishing normally; the point is that it settles WITHOUT run 1's help.
  const outcome = fixPanel.locator('[data-kind="diagnosis"]');
  await expect(outcome).toContainText(RUN2_DIAGNOSIS, { timeout: 15_000 });
  // Run 2 never calls replay_case (its one turn is a diagnosis) — so any appearance of it here could
  // only be a step leaked in from run 1, which the `onStep` guard must have suppressed.
  await expect(fixPanel.locator(".k-fix-steps")).not.toContainText("replay_case");

  // Only now let run 1's late response land — its `.then(setFixOutcome)` fires, and the `fixRunId`
  // guard (not the abort signal, which loop.ts never rechecks after this exact await — see the
  // comment on `runFix` in App.tsx) is what has to stop it from landing.
  expect(holdRoute).not.toBeNull();
  await holdRoute!.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ choices: [{ message: { content: `NOT-IN-APP: ${RUN1_LATE}` } }] }),
  });

  // Give the late `.then` a turn of the event loop to (try to) run, then assert it changed nothing:
  // still run 2's outcome on screen, and run 1's distinguishable text never appears anywhere in it.
  await page.waitForTimeout(500);
  await expect(fixPanel).toContainText(RUN2_DIAGNOSIS);
  await expect(fixPanel).not.toContainText(RUN1_LATE);
});
