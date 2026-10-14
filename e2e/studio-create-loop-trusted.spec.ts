import { test, expect } from "@playwright/test";
import { ask, chooseOpenRouter, openFromCard, openNewStudio } from "./studio-helpers.js";

// A new app through the create loop (#262 phase 3), end to end with a scripted OpenRouter: the first
// draft looks a declaration up (the real lookup, in the browser), then sends an app whose page lists
// an entity it never declares — the real validator turns it back. A second, independent draft (its
// own conversation, which never saw the first) sends the good app; it is checked and run, and the
// Studio shows it as the conversation's card.

const app = (entity: string) =>
  `import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", label: "Title", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "${entity}", display: { primary: "title" } } }],\n});`;

type Msg = { role: string; content: string };
type Body = { messages: Msg[]; tools?: Array<{ function: { name: string } }>; temperature?: number };
const reply = (message: Record<string, unknown>) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });

test("a new app through the create loop: a draft the gate turns back, an independent second draft, a card", async ({ page }) => {
  const bodies: Body[] = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as Body;
    bodies.push(body);
    const n = bodies.length;
    if (n === 1) return route.fulfill(reply({ content: "", tool_calls: [{ id: "l1", type: "function", function: { name: "lookup", arguments: '{"query":"ListView"}' } }] }));
    if (n === 2) return route.fulfill(reply({ content: "```ts\n" + app("books") + "\n```" }));
    return route.fulfill(reply({ content: "```ts\n" + app("book") + "\n```" }));
  });

  const studio = await openNewStudio(page);
  await chooseOpenRouter(page, studio);
  await ask(studio, "a reading tracker for my books");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });

  expect(bodies).toHaveLength(3);
  // The loop's first call: the create turn, with the tools a create has.
  expect(bodies[0]!.messages[1]!.content).toContain('Create a Potyro app for this request:\n\n"a reading tracker for my books"');
  expect(bodies[0]!.tools!.map((t) => t.function.name)).toEqual(expect.arrayContaining(["lookup", "check", "search_corpus", "read"]));
  // The lookup ran in the browser and its answer went back.
  expect(bodies[1]!.messages.at(-1)).toMatchObject({ role: "tool" });
  expect(bodies[1]!.messages.at(-1)!.content).toContain("ListView");
  // The second draft is independent: the same opening, nothing of the first, sampled wider.
  expect(bodies[2]!.messages).toHaveLength(2);
  expect(bodies[2]!.messages[1]!.content).toBe(bodies[0]!.messages[1]!.content);
  expect(JSON.stringify(bodies[2]!.messages)).not.toContain('entity: \\"books\\"');
  expect(bodies[2]!.temperature).toBeGreaterThan(bodies[0]!.temperature!);
});
