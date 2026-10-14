import { test, expect } from "@playwright/test";
import { ask, chooseOpenRouter, currentCard, openFromCard, openHistory, openNewStudio, openSource } from "./studio-helpers.js";

// One action and one engine. The engine is chosen in Model settings and used by BOTH create and
// modify — it used to follow whichever generate button you last pressed, so reaching the cloud for
// an edit meant pressing "Cloud" first, which replaced the app you were editing.
test("the chosen engine drives BOTH create and modify", async ({ page }) => {
  const hits: string[] = [];
  const sent: string[] = [];
  const app = (extra: string) =>
    '```ts\nimport { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true }' +
    extra +
    ' } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});\n```';

  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as { messages: Array<{ role: string; content: string }> };
    hits.push("openrouter");
    sent.push(JSON.stringify(body.messages));
    // The first (create) answer takes a moment, as a real one does: an instant reply left the
    // heartbeat below on screen for less time than the check takes to look for it.
    if (hits.length === 1) await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [{ message: { content: app(hits.length === 1 ? "" : ', rating: { type: "number", min: 0, max: 5 } ') } }],
      }),
    });
  });
  await page.route("**/__generate**", (route) => (hits.push("claude-cli"), route.abort()));

  // From the home screen: a Studio opened there is for making a new app. Opened from inside an app
  // it is for changing THAT app, and opens on it (reported 2026-09-13).
  const studio = await openNewStudio(page);

  // Nothing made yet: the one send action creates.
  const go = studio.getByRole("button", { name: /Create the app|Modify the app/ });
  await expect(go).toHaveAccessibleName("Create the app");

  // The engine is named on its own button, and chosen in one modal.
  const settings = studio.getByRole("button", { name: "Model settings" });
  await expect(settings).toContainText("claude -p");
  await chooseOpenRouter(page, studio);
  await expect(settings).toContainText("OpenRouter · DeepSeek V4 Flash");

  await studio.getByRole("textbox", { name: "Describe the app" }).fill("a reading tracker");
  await go.click();
  await expect(studio.getByText(/via OpenRouter · DeepSeek V4 Flash… \d+s/)).toBeVisible({ timeout: 10_000 });
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });

  // Now there IS an app, so the SAME button becomes the edit action — no second engine to choose.
  await expect(go).toHaveAccessibleName("Modify the app");

  await ask(studio, "add a 5-star rating field");
  // Wait for what the Studio SAYS it did — the new version's card (the stub answers with the whole
  // file, which the loop accepts and labels) — rather than racing the source.
  await expect(currentCard(studio).locator(".k-card-seq")).toHaveText("v2", { timeout: 60_000 });
  await expect(currentCard(studio).locator(".k-card-what")).toHaveText(/whole file|Applied/);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });

  const tools = await openSource(page, studio);
  const after = await tools.getByRole("textbox", { name: "App source" }).inputValue();
  expect(after).toContain("rating"); // the change landed
  expect(after).toContain('id: "reader"'); // and the app was not replaced
  expect(sent[1]).toContain("reader"); // the CURRENT source travelled with the edit
  expect(sent[1]).toContain("add a 5-star rating field");
  expect(hits).toEqual(["openrouter", "openrouter"]); // claude -p never touched
});

// The edit contract, end to end in the Studio. The model's reply is prose plus ONE SEARCH/REPLACE
// block, and what has to hold is that the block landed and NOTHING ELSE MOVED — the whole reason
// edits replaced whole-file replies is that retyping the untouched lines damaged them.
test("an edit-block reply changes only the lines it names, and the Studio says how many", async ({ page }) => {
  const CREATED = [
    'import { defineApp } from "potyro";',
    "export default defineApp({",
    '  id: "reader",',
    '  name: "Reader",',
    '  version: "1.0.0",',
    "  schemaVersion: 1,",
    '  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },',
    '  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],',
    "});",
  ].join("\n");
  const PAGES_LINE = CREATED.split("\n")[7]!;
  const ENTITIES_LINE = CREATED.split("\n")[6]!;
  // One line, one change: the page's title. The entity line beside it must come back byte-identical.
  const EDIT_REPLY = [
    "Renaming the page.",
    "```ts",
    "<<<<<<< SEARCH",
    PAGES_LINE,
    "=======",
    PAGES_LINE.replace('title: "Books"', 'title: "Every book"'),
    ">>>>>>> REPLACE",
    "```",
  ].join("\n");

  let turn = 0;
  await page.route("**/openrouter.ai/**", async (route) => {
    turn += 1;
    const content = turn === 1 ? "```ts\n" + CREATED + "\n```" : EDIT_REPLY;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content } }] }),
    });
  });

  const studio = await openNewStudio(page);
  await chooseOpenRouter(page, studio);

  await ask(studio, "a reading tracker");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });

  await ask(studio, "call the page Every book");

  // How the change arrived, on the new version's card — not as an error, and nothing held back.
  await expect(currentCard(studio).locator(".k-card-seq")).toHaveText("v2", { timeout: 60_000 });
  await expect(currentCard(studio).locator(".k-card-what")).toHaveText("Applied 1 edit.");
  await expect(studio.locator(".k-card-held")).toHaveCount(0);

  const tools = await openSource(page, studio);
  const after = await tools.getByRole("textbox", { name: "App source" }).inputValue();
  expect(after).toContain('title: "Every book"'); // the edit landed
  expect(after).not.toContain('title: "Books"');
  expect(after).toContain(ENTITIES_LINE); // and the line next to it was never retyped
  expect(after).toContain('id: "reader"');
});

// Every version is kept as it is made (#261). The old Studio held a draft until Save, so a closed tab
// lost the app AND what had been asked for it; now the app is in the launcher the moment it exists,
// History has the request, and starting another app leaves nothing behind.
test("a made app is kept at once, with what was asked in its history", async ({ page }) => {
  await page.route("**/openrouter.ai/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [
          {
            message: {
              content:
                '```ts\nimport { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});\n```',
            },
          },
        ],
      }),
    }),
  );

  const studio = await openNewStudio(page);

  // Before anything is made, History says there is nothing yet rather than showing an empty list.
  const empty = await openHistory(page, studio);
  await expect(empty.getByText(/Nothing yet/)).toBeVisible();
  await empty.getByRole("button", { name: "Close code and history" }).click();

  await chooseOpenRouter(page, studio);
  await ask(studio, "a reading tracker");
  await expect(currentCard(studio)).toBeVisible({ timeout: 60_000 });
  await expect(currentCard(studio).locator(".k-card-name")).toContainText("Reader");

  // Saved, with nothing pressed: it is in My Apps, and its history carries the request.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<{ id: string; name: string }>);
  expect(saved.map((a) => a.name)).toContain("Reader");
  const history = await openHistory(page, studio);
  await expect(history.locator(".k-studio-history").getByText("a reading tracker")).toBeVisible();
  await history.getByRole("button", { name: "Close code and history" }).click();

  // Starting another app asks nothing — there is nothing to lose — and starts from empty.
  await studio.getByRole("button", { name: "Studio menu" }).click();
  await page.getByRole("menuitem", { name: "Start a new app" }).click();
  await expect(page.locator(".k-dialog")).toHaveCount(0);
  await expect(studio.getByRole("heading", { name: "What would you like to make?" })).toBeVisible();
  await expect(studio.getByRole("button", { name: "Create the app" })).toBeVisible();
});

// A generate that comes back structurally broken is repaired through the SAME gate as a modify — an
// edit block, not a whole-file rewrite. Before this, a repair asked for the whole file again, so a
// good edit followed by one validation slip reintroduced the retyping the edit format exists to
// prevent. This drives GENERATE with an invalid reply, then proves the follow-up repair round is an
// edit, applied, and that the validator's own words (not just "fix it") reached the model.
test("a generate that needs repair is repaired with an edit, through the same gate as a modify", async ({ page }) => {
  // Pretty-printed so the page's view sits on its own lines — the repair edit below targets exactly
  // one of them.
  const GENERATED = [
    'import { defineApp } from "potyro";',
    "export default defineApp({",
    '  id: "reader",',
    '  name: "Reader",',
    '  version: "1.0.0",',
    "  schemaVersion: 1,",
    '  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },',
    "  pages: [",
    "    {",
    '      id: "all",',
    '      title: "Books",',
    "      view: {",
    '        type: "lisst",',
    '        entity: "book",',
    '        display: { primary: "title" },',
    "      },",
    "    },",
    "  ],",
    "});",
  ].join("\n");
  // The repair reply: an edit block, not a whole file — landing only the line the validator named.
  const EDIT_REPLY = [
    "Fixing the view type.",
    "```ts",
    "<<<<<<< SEARCH",
    '        type: "lisst",',
    "=======",
    '        type: "list",',
    ">>>>>>> REPLACE",
    "```",
  ].join("\n");

  const hits: string[] = [];
  const sent: string[] = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as { messages: Array<{ role: string; content: string }> };
    hits.push("openrouter");
    sent.push(JSON.stringify(body.messages));
    const content = hits.length === 1 ? "```ts\n" + GENERATED + "\n```" : EDIT_REPLY;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content } }] }),
    });
  });

  const studio = await openNewStudio(page);
  await chooseOpenRouter(page, studio);

  await ask(studio, "a reading tracker");
  // The repair round runs after the first (invalid) build, so the card waits out both.
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });

  await expect(currentCard(studio).locator(".k-card-what")).toContainText("Repaired with 1 edit.");
  await expect(studio.locator(".k-card-held")).toHaveCount(0);
  await expect(page.locator(".k-form-error")).toHaveCount(0);

  const tools = await openSource(page, studio);
  const after = await tools.getByRole("textbox", { name: "App source" }).inputValue();
  expect(after).toContain('type: "list"'); // the repair landed
  expect(after).not.toContain('type: "lisst"');

  // Exactly two requests: the invalid generate, then one repair round — no extra retries.
  expect(hits).toEqual(["openrouter", "openrouter"]);
  expect(sent[1]).toContain("Fix exactly these problems"); // buildRepairInstruction's own words
  // The validator's own words reached the model — including the bad value itself (#76), so the
  // model can SEARCH for the line it wrote rather than hunt for it from a path.
  expect(sent[1]).toContain("Invalid discriminator value");
  expect(sent[1]).toMatch(/got \\?"lisst\\?"/);
});
