import { test, expect } from "@playwright/test";

// One action and one engine. The engine is chosen in Model settings and used by BOTH create and
// modify — it used to follow whichever generate button you last pressed, so reaching the cloud for
// an edit meant pressing "Cloud" first, which replaced the app you were editing.
test("the chosen engine drives BOTH create and modify", async ({ page }) => {
  const hits: string[] = [];
  const sent: string[] = [];
  const app = (extra: string) =>
    '```ts\nimport { defineApp } from "karta";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true }' +
    extra +
    ' } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});\n```';

  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as { messages: Array<{ role: string; content: string }> };
    hits.push("openrouter");
    sent.push(JSON.stringify(body.messages));
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
  await page.goto("/");
  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("My App", { timeout: 60_000 });

  // An untouched starter is an empty page, not an app to edit.
  const go = studio.getByRole("button", { name: /Create the app|Modify the app/ });
  await expect(go).toHaveText(/Create the app/);

  // The engine is named on its own button, and chosen in one modal.
  const settings = studio.getByRole("button", { name: "Model settings" });
  await expect(settings).toContainText("claude -p");
  await settings.click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await modal.getByLabel("OpenRouter API key").fill("sk-or-stub");
  await modal.getByRole("button", { name: "Close model settings" }).click();
  await expect(settings).toContainText("OpenRouter \u00b7 DeepSeek V4 Flash");

  await studio.getByRole("textbox", { name: "Describe the app" }).fill("a reading tracker");
  await go.click();
  await expect(studio.getByText(/via OpenRouter \u00b7 DeepSeek V4 Flash\u2026 \d+s/)).toBeVisible({ timeout: 10_000 });
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("Reader", { timeout: 60_000 });

  // Now there IS an app, so the SAME button becomes the edit action — no second engine to choose.
  await expect(go).toHaveText(/Modify the app/);

  await studio.getByRole("textbox", { name: "Describe the app" }).fill("add a 5-star rating field");
  await go.click();
  // The h1 already reads "Reader" before the modify, so wait for the modify's own note (the stub
  // answers with the whole file, which the loop accepts and labels) rather than racing the source.
  await expect(studio.locator(".k-modify-note")).toHaveText(/whole file|Applied/, { timeout: 60_000 });
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("Reader", { timeout: 60_000 });

  await studio.getByRole("tab", { name: "Source" }).click();
  const after = await studio.getByRole("textbox", { name: "App source" }).inputValue();
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
    'import { defineApp } from "karta";',
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

  // From the home screen: a Studio opened there is for making a new app. Opened from inside an app
  // it is for changing THAT app, and opens on it (reported 2026-09-13).
  await page.goto("/");
  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("My App", { timeout: 60_000 });

  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await modal.getByLabel("OpenRouter API key").fill("sk-or-stub");
  await modal.getByRole("button", { name: "Close model settings" }).click();

  await studio.getByRole("textbox", { name: "Describe the app" }).fill("a reading tracker");
  await studio.getByRole("button", { name: /Create the app/ }).click();
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("Reader", { timeout: 60_000 });

  await studio.getByRole("textbox", { name: "Describe the app" }).fill("call the page Every book");
  await studio.getByRole("button", { name: /Modify the app/ }).click();

  // How the change arrived, in the neutral note rather than as an error.
  await expect(studio.locator(".k-modify-note")).toHaveText("Applied 1 edit.", { timeout: 60_000 });
  await expect(studio.locator(".k-modify-loss")).toHaveCount(0);

  await studio.getByRole("tab", { name: "Source" }).click();
  const after = await studio.getByRole("textbox", { name: "App source" }).inputValue();
  expect(after).toContain('title: "Every book"'); // the edit landed
  expect(after).not.toContain('title: "Books"');
  expect(after).toContain(ENTITIES_LINE); // and the line next to it was never retyped
  expect(after).toContain('id: "reader"');
});

test("the History tab shows this session before anything is saved, and New draft asks first", async ({ page }) => {
  await page.route("**/openrouter.ai/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        choices: [
          {
            message: {
              content:
                '```ts\nimport { defineApp } from "karta";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});\n```',
            },
          },
        ],
      }),
    }),
  );

  // From the home screen: a Studio opened there is for making a new app. Opened from inside an app
  // it is for changing THAT app, and opens on it (reported 2026-09-13).
  await page.goto("/");
  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("My App", { timeout: 60_000 });

  await studio.getByRole("tab", { name: "History" }).click();
  await expect(studio.getByText(/Nothing yet/)).toBeVisible();

  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await modal.getByLabel("OpenRouter API key").fill("sk-or-stub");
  await modal.getByRole("button", { name: "Close model settings" }).click();

  await studio.getByRole("textbox", { name: "Describe the app" }).fill("a reading tracker");
  await studio.getByRole("button", { name: /Create the app/ }).click();
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("Reader", { timeout: 60_000 });

  // The prompt is in history immediately — before any save.
  await studio.getByRole("tab", { name: "History" }).click();
  await expect(studio.locator(".k-studio-history").getByText("a reading tracker")).toBeVisible();

  // New draft discards an app that was never saved, so it must ask.
  page.once("dialog", () => {});
  await studio.getByRole("button", { name: "New draft" }).click();
  const confirm = page.locator(".k-dialog");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(/never been saved/);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await studio.getByRole("tab", { name: "Preview" }).click();
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("Reader"); // cancel kept it

  await studio.getByRole("button", { name: "New draft" }).click();
  await confirm.getByRole("button", { name: "Confirm" }).click();
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("My App", { timeout: 60_000 });
  await expect(studio.getByRole("button", { name: /Create the app/ })).toBeVisible(); // back to empty
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
    'import { defineApp } from "karta";',
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

  // From the home screen: a Studio opened there is for making a new app. Opened from inside an app
  // it is for changing THAT app, and opens on it (reported 2026-09-13).
  await page.goto("/");
  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("My App", { timeout: 60_000 });

  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await modal.getByLabel("OpenRouter API key").fill("sk-or-stub");
  await modal.getByRole("button", { name: "Close model settings" }).click();

  await studio.getByRole("textbox", { name: "Describe the app" }).fill("a reading tracker");
  await studio.getByRole("button", { name: /Create the app/ }).click();
  // withGen's autoRepair round runs after the first (invalid) preview build, so this waits out both.
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("Reader", { timeout: 60_000 });

  await expect(studio.locator(".k-modify-note")).toHaveText("Repaired with 1 edit.", { timeout: 60_000 });
  await expect(page.locator(".k-form-error")).toHaveCount(0);

  await studio.getByRole("tab", { name: "Source" }).click();
  const after = await studio.getByRole("textbox", { name: "App source" }).inputValue();
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
