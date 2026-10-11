import { test, expect, type Page } from "@playwright/test";

// The modify loop RUNS a candidate before accepting it, and can read the release's corpus (#262), end
// to end in the Studio with a scripted OpenRouter. The run happens in the browser: the candidate is
// bundled, loaded in the isolate on a throwaway store, seeded, and its pages mounted. Fails if a
// candidate that validates but throws when it runs is still accepted, or if the corpus tool answers
// from anywhere but the release.

const APP =
  'import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});';

const BOOK = '  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },';
const edit = (prose: string, replace: string) => `${prose}\n\`\`\`ts\n<<<<<<< SEARCH\n${BOOK}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\``;

// Validates — a computed is a function — and throws the moment a record resolves: ctx has no `ratings`.
const BROKEN = edit(
  "Adding a score.",
  '  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } }, computed: { score: (b, ctx) => ctx.ratings.lookup(b.title) } } },',
);
const FIXED = edit(
  "Adding a score from the title's length.",
  '  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } }, computed: { score: (b) => String(b.title ?? "").length } } },',
);

type Msg = { role: string; content: string; tool_calls?: unknown };
const reply = (message: Record<string, unknown>) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });

async function createReader(page: Page, script: (n: number) => Record<string, unknown>): Promise<Msg[][]> {
  const requests: Msg[][] = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as { messages: Msg[] };
    requests.push(body.messages);
    const n = requests.length;
    return route.fulfill(reply(n === 1 ? { content: "```ts\n" + APP + "\n```" } : script(n)));
  });

  await page.goto("/");
  await page.getByRole("button", { name: /New app/ }).click();
  const studio = page.locator(".k-studio");
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("My App", { timeout: 60_000 });
  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await modal.getByLabel("OpenRouter API key").fill("sk-or-stub");
  await modal.getByRole("button", { name: "Close model settings" }).click();

  await studio.getByRole("textbox", { name: "Describe the app" }).fill("a reading tracker");
  await studio.getByRole("button", { name: /Create the app|Modify the app/ }).click();
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("Reader", { timeout: 60_000 });
  return requests;
}

test("a candidate that validates but throws when it runs is sent back with the error", async ({ page }) => {
  const requests = await createReader(page, (n) => ({ content: n === 2 ? BROKEN : FIXED }));
  const studio = page.locator(".k-studio");
  await studio.getByRole("textbox", { name: "Describe the app" }).fill("give each book a score");
  await studio.getByRole("button", { name: /Create the app|Modify the app/ }).click();
  await expect(studio.getByText(/Applied 1 edit/)).toBeVisible({ timeout: 90_000 });

  expect(requests).toHaveLength(3);
  const sentBack = requests[2]!.at(-1)!;
  expect(sentBack.role).toBe("user");
  // The run's own words: what broke, where, and that it ran on sample records — not the validator's.
  // Judged against the app as first shown (#262): the failure is the change's, so it is named as such.
  expect(sentBack.content).toMatch(/your change breaks it when it runs/);
  expect(sentBack.content).not.toMatch(/already failing before this change/i);
  expect(sentBack.content).toMatch(/computed book\.score/);
  // QuickJS's own words for `ctx.ratings.lookup` on a ctx with no `ratings`.
  expect(sentBack.content).toMatch(/cannot read property 'lookup' of undefined/);

  await studio.getByRole("tab", { name: "Source" }).click();
  await expect(studio.getByRole("textbox", { name: "App source" })).toHaveValue(/String\(b\.title/);
});

test("search_corpus answers from the release's example apps, inside the browser", async ({ page }) => {
  const requests = await createReader(page, (n) =>
    n === 2
      ? { content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "search_corpus", arguments: '{"query":"custom view render"}' } }] }
      : { content: FIXED },
  );
  const studio = page.locator(".k-studio");
  await studio.getByRole("textbox", { name: "Describe the app" }).fill("give each book a score");
  await studio.getByRole("button", { name: /Create the app|Modify the app/ }).click();
  await expect(studio.getByText(/Applied 1 edit/)).toBeVisible({ timeout: 90_000 });

  const toolTurn = requests[2]!.at(-1)!;
  expect(toolTurn.role).toBe("tool");
  expect(toolTurn.content).toMatch(/^--- (examples|apps)\/[^\n]+\.app\.tsx?:\d+-\d+/m);
});
