import { test, expect, type Page } from "./console-guard";
import { ask, chooseOpenRouter, currentCard, openFromCard, openNewStudio, asksForSamples, noSamples } from "./studio-helpers.js";

// A request done in part says what was not done (#73), end to end with a scripted OpenRouter:
//
//   - the model lifts a rule from ONE field (here `required`) on a request that names no field. The
//     loop holds the change against the app's own structure and asks once, naming the field of the
//     same shape that was left as it was. Fails if no such round is made (the request count says);
//   - answered with a `Not done:` line, the change that passed is saved as it was, and the line is on
//     the version's card as a list of its own, under what was done, with the Studio's words above it.
//     It stays on that card when a later version takes its place, and after the Studio is reopened;
//   - answered with a fuller change, THAT change is what is saved, and the card lists nothing.

type Message = { role: string; content: string | null };

const AUTHOR = 'author: { type: "text", label: "Author", required: true }';
const PUBLISHER = 'publisher: { type: "text", label: "Publisher", required: true }';
const BOOK = `  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", label: "Title" }, ${AUTHOR}, ${PUBLISHER} } } },`;
const APP = `import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n${BOOK}\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});`;
const AUTHOR_FREE = 'author: { type: "text", label: "Author" }';
const PUBLISHER_FREE = 'publisher: { type: "text", label: "Publisher" }';
// An edit names whole lines, and the fields share one: each change is that line, rewritten.
const ONE = BOOK.replace(AUTHOR, AUTHOR_FREE);
const BOTH = ONE.replace(PUBLISHER, PUBLISHER_FREE);
const LEFT = "Publisher still has to be filled in: the list of books is sorted by it";

const block = (search: string, replace: string): string => `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;
const edits = (prose: string, ...blocks: string[]): string => `${prose}\n\`\`\`ts\n${blocks.join("\n")}\n\`\`\``;
const reply = (content: string) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content } }] }) });

/** The app as it is saved on the device. */
const storedSource = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as { id: string; source: string }[];
    return apps.find((a) => a.id === "reader")?.source ?? "";
  });

/** Script the model turn by turn; every request's messages are kept for the assertions. */
async function script(page: Page, turns: string[]): Promise<Message[][]> {
  const requests: Message[][] = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as { messages: Message[] };
    if (asksForSamples(body)) return route.fulfill(noSamples());
    requests.push(body.messages);
    const turn = turns[requests.length - 1];
    if (turn === undefined) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "the script has no more turns" } }) });
    return route.fulfill(reply(turn));
  });
  return requests;
}

async function madeReader(page: Page) {
  const studio = await openNewStudio(page);
  await chooseOpenRouter(page, studio);
  await ask(studio, "a reading tracker");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });
  return studio;
}

// The request names no field: which fields it is about is the model's to work out, and the loop's to check.
const REQUEST = "saving a book fails when I leave things empty, stop that";

test("a rule lifted from one field and left on another: the model is asked once, and what it says was not done is on the card", async ({ page }) => {
  const requests = await script(page, [
    "```ts\n" + APP + "\n```",
    edits("A book can now be saved without an author.", block(BOOK, ONE)),
    `Not done:\n- ${LEFT}`,
    edits("Books can carry a note.", block(ONE, ONE.replace(PUBLISHER, `${PUBLISHER}, note: { type: "text", label: "Note" }`))),
  ]);

  const studio = await madeReader(page);
  await ask(studio, REQUEST);

  const card = currentCard(studio);
  await expect(card.locator(".k-card-what")).toContainText("A book can now be saved without an author.", { timeout: 60_000 });

  // One round more than the change itself: the loop asked about the field it left with the same rule.
  expect(requests).toHaveLength(3);
  const note = requests[2]!.at(-1)!;
  expect(note.role).toBe("user");
  expect(note.content).toContain('"Author" (book.author) lost `required`');
  expect(note.content).toContain('"Publisher" (book.publisher)');
  // The title never had the rule: it is not a sibling.
  expect(note.content).not.toContain("book.title");

  // What was not done: a list of its own, under what was done, never inside those words.
  const list = card.getByRole("list", { name: "What was not done" });
  await expect(list.getByRole("listitem")).toHaveText([LEFT]);
  await expect(card.locator(".k-notdone-label")).toHaveText("Not done, from what you asked:");
  await expect(card.locator(".k-card-what")).not.toContainText("Not done");
  await expect(card.locator(".k-card-what")).not.toContainText("Publisher still");
  // The change that passed is what was saved, as it was.
  const saved = await storedSource(page);
  expect(saved).toContain(AUTHOR_FREE);
  expect(saved).toContain(PUBLISHER);

  // A later version takes its place; the fact stays on the card of the version it is about.
  await ask(studio, "add a note to each book");
  await expect(currentCard(studio).locator(".k-card-what")).toContainText("Books can carry a note.", { timeout: 60_000 });
  await expect(currentCard(studio).locator(".k-notdone")).toHaveCount(0);
  await expect(studio.getByRole("list", { name: "What was not done" }).getByRole("listitem")).toHaveText([LEFT]);
  // And the model was told, with that version, what it had left undone.
  expect(JSON.stringify(requests[3])).toContain(`Not done: ${LEFT}`);

  // Kept with the conversation: still there when the Studio is opened again.
  await page.goto("/?user=reader");
  await expect(page.locator("h1").first()).toHaveText("Reader", { timeout: 30_000 });
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(page.locator(".k-studio").getByRole("list", { name: "What was not done" }).getByRole("listitem")).toHaveText([LEFT], { timeout: 30_000 });
});

test("answered with a fuller change, that change is what is saved, and nothing is listed as not done", async ({ page }) => {
  const requests = await script(page, [
    "```ts\n" + APP + "\n```",
    edits("A book can now be saved without an author.", block(BOOK, ONE)),
    edits("A book can now be saved without an author or a publisher.", block(BOOK, BOTH)),
  ]);

  const studio = await madeReader(page);
  await ask(studio, REQUEST);

  const card = currentCard(studio);
  await expect(card.locator(".k-card-what")).toContainText("without an author or a publisher", { timeout: 60_000 });
  expect(requests).toHaveLength(3);
  await expect(card.locator(".k-notdone")).toHaveCount(0);
  const saved = await storedSource(page);
  expect(saved).toContain(AUTHOR_FREE);
  expect(saved).toContain(PUBLISHER_FREE);
});

test("a change that answers every part is not asked about", async ({ page }) => {
  const requests = await script(page, ["```ts\n" + APP + "\n```", edits("A book can now be saved without an author or a publisher.", block(BOOK, BOTH))]);

  const studio = await madeReader(page);
  await ask(studio, REQUEST);

  await expect(currentCard(studio).locator(".k-card-what")).toContainText("without an author or a publisher", { timeout: 60_000 });
  expect(requests).toHaveLength(2);
  await expect(currentCard(studio).locator(".k-notdone")).toHaveCount(0);
});
