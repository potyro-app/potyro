import { test, expect } from "./console-guard";
import { ask, chooseOpenRouter, currentCard, openFromCard, openNewStudio } from "./studio-helpers.js";

// The modify loop can read the release's corpus (#262), end to end in the Studio with a scripted
// OpenRouter: the model calls `search_corpus`, and the answer comes from the example apps bundled with
// THIS build, inside the browser — not from the model, not from the network.

const APP =
  'import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});';

const EDITS =
  "Adding the rating.\n```ts\n<<<<<<< SEARCH\n  entities: { book: { label: \"Book\", displayField: \"title\", fields: { title: { type: \"text\", required: true } } } },\n=======\n  entities: { book: { label: \"Book\", displayField: \"title\", fields: { title: { type: \"text\", required: true }, rating: { type: \"number\", min: 0, max: 5 } } } },\n>>>>>>> REPLACE\n```";

type Msg = { role: string; content: string; tool_calls?: unknown };

test("search_corpus answers from the release's example apps, inside the browser", async ({ page }) => {
  const requests: Msg[][] = [];
  const reply = (message: Record<string, unknown>) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });
  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as { messages: Msg[] };
    requests.push(body.messages);
    const n = requests.length;
    if (n === 1) return route.fulfill(reply({ content: "```ts\n" + APP + "\n```" }));
    if (n === 2) return route.fulfill(reply({ content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "search_corpus", arguments: '{"query":"cook along steps custom view"}' } }] }));
    return route.fulfill(reply({ content: EDITS }));
  });

  // The Studio is a conversation (#261): the app is made, its card appears, and it opens from there.
  const studio = await openNewStudio(page);
  await chooseOpenRouter(page, studio);

  await ask(studio, "a reading tracker");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });

  await ask(studio, "add a 5-star rating field");
  await expect(currentCard(studio).locator(".k-card-what")).toHaveText(/Applied 1 edit/, { timeout: 60_000 });

  expect(requests).toHaveLength(3);
  const toolTurn = requests[2]!.at(-1)!;
  expect(toolTurn.role).toBe("tool");
  // A passage from a bundled example app, with its path and lines — the corpus, not the model.
  expect(toolTurn.content).toMatch(/^--- (examples|apps)\/[^\n]+\.app\.tsx?:\d+-\d+/m);
});
