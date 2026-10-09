import { test, expect } from "@playwright/test";

// The modify LOOP (#131), end to end in the Studio with a scripted OpenRouter: the model refuses
// without looking, is sent to the tools, calls `lookup`, gets the real declaration back inside the
// browser, and then sends SEARCH/REPLACE edits that the browser bundles, validates and applies.
// Fails if the Studio still takes the one-turn path (no nudge, no tool round-trip).

const APP =
  'import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});';

const EDITS =
  "Adding the rating.\n```ts\n<<<<<<< SEARCH\n  entities: { book: { label: \"Book\", displayField: \"title\", fields: { title: { type: \"text\", required: true } } } },\n=======\n  entities: { book: { label: \"Book\", displayField: \"title\", fields: { title: { type: \"text\", required: true }, rating: { type: \"number\", min: 0, max: 5 } } } },\n>>>>>>> REPLACE\n```";

test("modify runs on the loop: an unlooked refusal is sent to lookup, then edits land", async ({ page }) => {
  const requests: Array<Array<{ role: string; content: string; tool_calls?: unknown }>> = [];
  const reply = (message: Record<string, unknown>) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });

  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as { messages: Array<{ role: string; content: string; tool_calls?: unknown }>; tools?: unknown[] };
    requests.push(body.messages);
    const n = requests.length;
    if (n === 1) return route.fulfill(reply({ content: "```ts\n" + APP + "\n```" })); // create
    if (n === 2) return route.fulfill(reply({ content: "NOT-IN-APP: books cannot have a rating." })); // refuses without looking
    if (n === 3) return route.fulfill(reply({ content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: '{"query":"NumberField"}' } }] }));
    return route.fulfill(reply({ content: EDITS }));
  });

  // From the home screen: a Studio opened there is for making a new app. Opened from inside an app
  // it is for changing THAT app, and opens on it (reported 2026-09-13).
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

  // The exchange the loop guarantees: nudge after the blind refusal, then the tool's answer.
  expect(requests).toHaveLength(4);
  const nudge = requests[2]!.at(-1)!;
  expect(nudge.role).toBe("user");
  expect(nudge.content).toMatch(/lookup/);
  const toolTurn = requests[3]!.at(-1)!;
  expect(toolTurn.role).toBe("tool");
  // The declaration came from the reference inside the browser, not from the model.
  expect(toolTurn.content).toContain("interface NumberField");

  await studio.getByRole("tab", { name: "Source" }).click();
  await expect(studio.getByRole("textbox", { name: "App source" })).toHaveValue(/rating: \{ type: "number"/);
});
