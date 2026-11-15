import { test, expect, type Page } from "./console-guard";
import { ask, chooseOpenRouter, currentCard, openFromCard, openNewStudio, asksForSamples, noSamples } from "./studio-helpers.js";

// The Studio as a session (#75), end to end with a scripted OpenRouter:
//
//   - the model asks with `ask_person`; its choices are buttons; one tap answers, and the answer goes
//     back into the SAME run as that call's result. Fails if the answer starts a new run (the request
//     count, and the conversation the model is sent, say which);
//   - what the model guessed (`Assumed:`) is on the version's card, and a tap starts the correction in
//     the box without sending it;
//   - a change that is not small (here: a field changes kind) is shown before it is saved. "Change
//     something" saves nothing and the next message refines the change that waits; Go saves exactly
//     what was made, with no further request to the model.

type Message = { role: string; content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>; tool_call_id?: string };

const BOOK = '  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true }, pages: { type: "text", label: "Pages" } } } },';
const APP = `import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n${BOOK}\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});`;

const edit = (prose: string, search: string, replace: string): string => `${prose}\n\`\`\`ts\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\``;
const reply = (message: Record<string, unknown>) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });

/** The app as it is saved on the device: what "nothing was saved" is read from. */
const storedSource = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as { id: string; source: string }[];
    return apps.find((a) => a.id === "reader")?.source ?? "";
  });

/** Script the model turn by turn; every request's messages are kept for the assertions. */
async function script(page: Page, turns: Array<Record<string, unknown>>): Promise<Message[][]> {
  const requests: Message[][] = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as { messages: Message[] };
    if (asksForSamples(body)) return route.fulfill(noSamples());
    requests.push(body.messages);
    const turn = turns[requests.length - 1];
    if (!turn) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "the script has no more turns" } }) });
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

test("a question comes with answers to tap, and the tap goes back into the run that asked", async ({ page }) => {
  const PRICED = BOOK.replace('pages: { type: "text", label: "Pages" }', 'pages: { type: "text", label: "Pages" }, price: { type: "number", label: "Price" }');
  const requests = await script(page, [
    { content: "```ts\n" + APP + "\n```" },
    {
      content: "",
      tool_calls: [
        {
          id: "ask_1",
          type: "function",
          function: { name: "ask_person", arguments: JSON.stringify({ question: "Which currency are the prices in?", options: ["Euros", "Dollars", "Each book says its own"] }) },
        },
      ],
    },
    { content: edit("Each book has a price, in euros.\n\nAssumed:\n- A book has one price.\n- Prices are whole amounts or cents, not ranges.", BOOK, PRICED) },
  ]);

  const studio = await madeReader(page);
  await ask(studio, "add what each book cost");

  // The question, where questions have always been, and its answers as real buttons.
  const question = studio.locator('.k-thread-answer[data-tone="question"]');
  await expect(question).toContainText("Which currency are the prices in?", { timeout: 60_000 });
  const choices = studio.getByRole("list", { name: "Answers to choose from" }).getByRole("button");
  await expect(choices).toHaveText(["Euros", "Dollars", "Each book says its own"]);
  // The box still takes an answer in the person's own words.
  await expect(studio.getByRole("textbox", { name: "Describe the app" })).toBeEnabled();
  expect(requests).toHaveLength(2);

  await choices.nth(0).click();

  // The answer is what the person said, in the conversation; and the change lands.
  await expect(currentCard(studio).locator(".k-card-what")).toContainText("Each book has a price, in euros.", { timeout: 60_000 });
  await expect(studio.locator(".k-thread")).toContainText("Euros");

  // One more request, not a new run: it is the conversation that asked, plus the call and its result.
  expect(requests).toHaveLength(3);
  const [asked, resumed] = [requests[1]!, requests[2]!];
  expect(resumed.slice(0, asked.length)).toEqual(asked);
  expect(resumed).toHaveLength(asked.length + 2);
  expect(resumed.at(-2)!.tool_calls?.[0]?.function.name).toBe("ask_person");
  const result = resumed.at(-1)!;
  expect(result.role).toBe("tool");
  expect(result.tool_call_id).toBe("ask_1");
  expect(result.content).toContain("Euros");

  // Once answered, the choices are no longer buttons.
  await expect(studio.locator(".k-question")).toHaveCount(0);
  expect(await storedSource(page)).toContain('price: { type: "number"');

  // What it guessed is on the card, under what changed, and the words that list it are not the card's prose.
  const card = currentCard(studio);
  await expect(card.locator(".k-card-what")).not.toContainText("Assumed");
  const guesses = card.getByRole("list", { name: "What was guessed" }).getByRole("button");
  await expect(guesses).toHaveText(["A book has one price.", "Prices are whole amounts or cents, not ranges."]);

  // A tap starts the correction and sends nothing.
  await guesses.nth(0).click();
  const box = studio.getByRole("textbox", { name: "Describe the app" });
  await expect(box).toHaveValue("About “A book has one price.”: ");
  await expect(box).toBeFocused();
  expect(requests).toHaveLength(3);
});

test("a change that is not small is shown first: Change something saves nothing, Go saves what was made", async ({ page }) => {
  const NUMBERED = BOOK.replace('pages: { type: "text", label: "Pages" }', 'pages: { type: "number", label: "Pages" }');
  const CAPPED = NUMBERED.replace('pages: { type: "number", label: "Pages" }', 'pages: { type: "number", label: "Pages", min: 1 }');
  const requests = await script(page, [
    { content: "```ts\n" + APP + "\n```" },
    { content: edit("The number of pages is now a number.", BOOK, NUMBERED) },
    { content: edit("The number of pages is a number, and at least 1.", NUMBERED, CAPPED) },
  ]);

  const studio = await madeReader(page);
  const before = await storedSource(page);
  expect(before).toContain('pages: { type: "text"');

  await ask(studio, "make pages a number");

  // A field changed kind: the change waits on a card of its own, said to be not saved yet.
  const plan = studio.locator(".k-card-plan");
  await expect(plan).toBeVisible({ timeout: 60_000 });
  await expect(plan).toContainText("not saved yet");
  await expect(plan.locator(".k-card-what")).toContainText("The number of pages is now a number.");
  await expect(plan.getByRole("button", { name: "Go", exact: true })).toBeEnabled();
  // The app's card is still the version before it, and the device still holds that version.
  await expect(currentCard(studio)).toHaveCount(1);
  expect(await storedSource(page)).toBe(before);
  expect(requests).toHaveLength(2);

  // Change something: the box, and nothing else. Nothing is saved, nothing is asked of the model.
  await plan.getByRole("button", { name: "Change something" }).click();
  await expect(studio.getByRole("textbox", { name: "Describe the app" })).toBeFocused();
  await expect(plan).toBeVisible();
  expect(await storedSource(page)).toBe(before);
  expect(requests).toHaveLength(2);

  // What is said next refines the change that waits: the model is shown THAT app, and told so.
  await ask(studio, "and never less than 1");
  await expect(studio.locator(".k-card-plan .k-card-what")).toContainText("at least 1", { timeout: 60_000 });
  expect(requests).toHaveLength(3);
  const refining = JSON.stringify(requests[2]);
  expect(refining).toContain("and never less than 1");
  expect(refining).toContain("seen and not kept yet");
  expect(refining).toContain('pages: { type: \\"number\\", label: \\"Pages\\" }');
  // Still not saved: it is still a change of kind against the app on the device.
  expect(await storedSource(page)).toBe(before);
  await expect(studio.locator(".k-card-plan")).toHaveCount(1);

  // Go: exactly what was made is saved, with no further request.
  await studio.locator(".k-card-plan").getByRole("button", { name: "Go", exact: true }).click();
  await expect(studio.locator(".k-card-plan")).toHaveCount(0, { timeout: 60_000 });
  await expect(currentCard(studio).locator(".k-card-what")).toContainText("at least 1");
  expect(await storedSource(page)).toContain('pages: { type: "number", label: "Pages", min: 1 }');
  expect(requests).toHaveLength(3);
});

test("a plan the Studio was closed on is not saved, and the conversation says so", async ({ page }) => {
  const NUMBERED = BOOK.replace('pages: { type: "text", label: "Pages" }', 'pages: { type: "number", label: "Pages" }');
  await script(page, [{ content: "```ts\n" + APP + "\n```" }, { content: edit("The number of pages is now a number.", BOOK, NUMBERED) }]);

  const studio = await madeReader(page);
  const before = await storedSource(page);
  await ask(studio, "make pages a number");
  await expect(studio.locator(".k-card-plan")).toBeVisible({ timeout: 60_000 });

  await page.goto("/?user=reader");
  await expect(page.locator("h1").first()).toHaveText("Reader", { timeout: 30_000 });
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  const again = page.locator(".k-studio");
  await expect(again.locator(".k-thread")).toContainText("The number of pages is now a number.", { timeout: 30_000 });
  await expect(again.locator(".k-plan-gone")).toHaveText("This change was not saved. Ask again and I’ll make it.");
  await expect(again.locator(".k-card-plan")).toHaveCount(0);
  expect(await storedSource(page)).toBe(before);
});
