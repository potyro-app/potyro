import { test, expect } from "./console-guard";
import { ask, chooseOpenRouter, currentCard, openFromCard, openNewStudio, openSource, asksForSamples, noSamples } from "./studio-helpers.js";

// The modify loop RUNS a candidate before accepting it (#262), end to end in the conversation-first
// Studio with a scripted OpenRouter. The run happens in the browser: the candidate is bundled, loaded
// in the isolate on a throwaway store, seeded, and its pages mounted. Fails if a candidate that
// validates but throws when it runs is still accepted. (The corpus tool has its own spec,
// studio-corpus-trusted.spec.ts.)

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

test("a candidate that validates but throws when it runs is sent back with the error", async ({ page }) => {
  const requests: Msg[][] = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as { messages: Msg[] };
    if (asksForSamples(body)) return route.fulfill(noSamples());
    requests.push(body.messages);
    const n = requests.length;
    return route.fulfill(reply(n === 1 ? { content: "```ts\n" + APP + "\n```" } : { content: n === 2 ? BROKEN : FIXED }));
  });

  const studio = await openNewStudio(page);
  await chooseOpenRouter(page, studio);
  await ask(studio, "a reading tracker");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });

  await ask(studio, "give each book a score");
  await expect(currentCard(studio).locator(".k-card-what")).toHaveText(/Applied 1 edit/, { timeout: 90_000 });

  expect(requests).toHaveLength(3);
  const sentBack = requests[2]!.at(-1)!;
  expect(sentBack.role).toBe("user");
  // The run's own words, judged against the app as first shown: the failure is the change's, and
  // QuickJS's own message for `ctx.ratings.lookup` on a ctx with no `ratings`.
  expect(sentBack.content).toMatch(/your change breaks it when it runs/);
  expect(sentBack.content).toMatch(/computed book\.score/);
  expect(sentBack.content).toMatch(/cannot read property 'lookup' of undefined/);
  expect(sentBack.content).not.toMatch(/already failing before this change/i);
  // The app is in the conversation exactly once: the first message, and nowhere after.
  expect(requests[2]!.filter((m) => m.content.includes('id: "reader"'))).toHaveLength(1);

  const tools = await openSource(page, studio);
  await expect(tools.getByRole("textbox", { name: "App source" })).toHaveValue(/String\(b\.title/);
});
