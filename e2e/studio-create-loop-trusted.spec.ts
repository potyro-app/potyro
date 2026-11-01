import { test, expect } from "./console-guard";
import { ask, chooseOpenRouter, openFromCard, openNewStudio } from "./studio-helpers.js";

// A new app through the create loop (#262 phase 3), end to end with a scripted OpenRouter. The first
// draft is one call with the tools off, and sends an app whose page lists an entity it never
// declares — the real validator turns it back. A second, independent draft (its own conversation,
// which never saw the first) is broken another way. The first is repaired with the tools on: a real
// lookup in the browser, then the corrected app, checked and run, and shown as the conversation's card.
// Once it passed, ONE more request asks for its sample records (#486); this one answers with no JSON,
// so the app keeps none — and is made all the same.

const app = (entity: string) =>
  `import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", label: "Title", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "${entity}", display: { primary: "title" } } }],\n});`;

type Msg = { role: string; content: string };
type Body = { messages: Msg[]; tools?: Array<{ function: { name: string } }>; tool_choice?: string; temperature?: number };
const reply = (message: Record<string, unknown>) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });

test("a new app through the create loop: two drafts the gate turns back, a repair with the tools, a card", async ({ page }) => {
  const bodies: Body[] = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as Body;
    bodies.push(body);
    const n = bodies.length;
    if (n === 1) return route.fulfill(reply({ content: "```ts\n" + app("books") + "\n```" }));
    if (n === 2) return route.fulfill(reply({ content: "```ts\n" + app("volume") + "\n```" }));
    if (n === 3) return route.fulfill(reply({ content: "", tool_calls: [{ id: "l1", type: "function", function: { name: "lookup", arguments: '{"query":"ListView"}' } }] }));
    return route.fulfill(reply({ content: "```ts\n" + app("book") + "\n```" }));
  });

  const studio = await openNewStudio(page);
  await chooseOpenRouter(page, studio);
  await ask(studio, "a reading tracker for my books");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });

  expect(bodies).toHaveLength(5);
  // The first draft: the create turn, one call, the tools declared but off.
  expect(bodies[0]!.messages[1]!.content).toContain('Create a Potyro app for this request:\n\n"a reading tracker for my books"');
  expect(bodies[0]!.tools!.map((t) => t.function.name)).toEqual(expect.arrayContaining(["lookup", "check", "search_corpus", "read"]));
  expect(bodies.slice(0, 4).map((b) => b.tool_choice)).toEqual(["none", "none", "auto", "auto"]);
  // The second draft is independent: the same opening, nothing of the first, sampled wider.
  expect(bodies[1]!.messages).toHaveLength(2);
  expect(bodies[1]!.messages[1]!.content).toBe(bodies[0]!.messages[1]!.content);
  expect(JSON.stringify(bodies[1]!.messages)).not.toContain('entity: \\"books\\"');
  expect(bodies[1]!.temperature).toBeGreaterThan(bodies[0]!.temperature!);
  // The repair continues the first draft, with the validator's words; the lookup ran in the browser.
  expect(JSON.stringify(bodies[2]!.messages)).toContain('entity: \\"books\\"');
  expect(bodies[3]!.messages.at(-1)).toMatchObject({ role: "tool" });
  expect(bodies[3]!.messages.at(-1)!.content).toContain("ListView");
  // The request for sample records: no tools, the app's entity in its shape — nothing of the person's.
  expect(bodies[4]!.tools).toBeUndefined();
  expect(bodies[4]!.messages[0]!.content).toContain("You write sample records");
  expect(bodies[4]!.messages[1]!.content).toContain('entity book ("Book")');
});
