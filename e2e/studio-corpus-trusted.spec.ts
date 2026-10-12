import { test, expect } from "@playwright/test";

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
    if (n === 2) return route.fulfill(reply({ content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "search_corpus", arguments: '{"query":"custom view render"}' } }] }));
    return route.fulfill(reply({ content: EDITS }));
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

  const go = studio.getByRole("button", { name: /Create the app|Modify the app/ });
  await studio.getByRole("textbox", { name: "Describe the app" }).fill("a reading tracker");
  await go.click();
  await expect(studio.locator(".k-studio-preview h1")).toHaveText("Reader", { timeout: 60_000 });

  await studio.getByRole("textbox", { name: "Describe the app" }).fill("add a 5-star rating field");
  await go.click();
  await expect(studio.getByText(/Applied 1 edit/)).toBeVisible({ timeout: 60_000 });

  expect(requests).toHaveLength(3);
  const toolTurn = requests[2]!.at(-1)!;
  expect(toolTurn.role).toBe("tool");
  // A passage from a bundled example app, with its path and lines — the corpus, not the model.
  expect(toolTurn.content).toMatch(/^--- (examples|apps)\/[^\n]+\.app\.tsx?:\d+-\d+/m);
});
