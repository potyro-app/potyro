import { test, expect } from "./console-guard";
import { ask, chooseOpenRouter, openFromCard, openNewStudio, asksForSamples, noSamples } from "./studio-helpers.js";

// "Potyro can't do this yet" (#263), end to end with a scripted OpenRouter: the agent looks a
// barcode reader up, finds nothing declares one (the real lookup), answers NEEDS-PLATFORM, and a last
// call with the tools off writes the request. The Studio shows it in plain words; the first tap shows
// exactly what would be sent, the second sends it. With no relay behind the site — the dev server, or
// a deployment that has not set one up — it is kept on the device; once the relay answers, it goes.

const APP =
  'import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});';

type Msg = { role: string; content: string };
type Body = { messages: Msg[]; tool_choice?: string };
const reply = (message: Record<string, unknown>) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });
const lookup = { content: "", tool_calls: [{ id: "l1", type: "function", function: { name: "lookup", arguments: JSON.stringify({ query: "barcodeScanner" }) } }] };

test("a request to the Potyro team: shown in plain words, reviewed, kept while the relay is away, then sent", async ({ page, consoleGuard }) => {
  consoleGuard.allow(/^Failed to load resource: the server responded with a status of 404/, "the team's endpoint answers 404 on purpose while the relay is 'away'");
  const model: Body[] = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    const body = route.request().postDataJSON() as Body;
    if (asksForSamples(body)) return route.fulfill(noSamples());
    model.push(body);
    const n = model.length;
    if (n === 1) return route.fulfill(reply({ content: "```ts\n" + APP + "\n```" }));
    if (body.tool_choice === "none") return route.fulfill(reply({ content: "TITLE: Scan barcodes\nI wanted to scan the barcode on a book so its title fills itself in." }));
    return route.fulfill(reply(n === 2 ? lookup : { content: "NEEDS-PLATFORM: reading barcodes with the camera" }));
  });
  const relay: unknown[] = [];
  let relayUp = false;
  await page.route("**/requests/platform-requests", async (route) => {
    relay.push(route.request().postDataJSON());
    if (!relayUp) return route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>Not found</title>" });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, issue: 7, url: "https://github.com/potyro-app/potyro/issues/7" }) });
  });

  const studio = await openNewStudio(page);
  await chooseOpenRouter(page, studio);
  await ask(studio, "a reading tracker");
  await openFromCard(studio);

  await ask(studio, "let me scan the barcode on a book to add it");
  const card = studio.locator(".k-ask-card");
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card).toContainText("Potyro can't do this yet");
  await expect(card).toContainText("Scan barcodes");
  await expect(card).toContainText("I wanted to scan the barcode on a book");
  // The marker and the code stay behind the scenes.
  await expect(studio.locator(".k-thread")).not.toContainText("NEEDS-PLATFORM");
  // The lookup found nothing, so the loop offered the way out; the last call had the tools off.
  expect(model.find((b) => b.messages.some((m) => m.role === "tool" && m.content.includes("NEEDS-PLATFORM:")))).toBeTruthy();
  expect(model.at(-1)!.tool_choice).toBe("none");

  // First tap: what would be sent, and nothing sent yet.
  await card.getByRole("button", { name: "Send to the Potyro team" }).click();
  const review = card.getByRole("group", { name: "What will be sent" });
  await expect(review).toBeVisible();
  await review.locator("summary", { hasText: "How your app is put together" }).click();
  await expect(review.locator("pre")).toContainText('"book"');
  expect(relay).toHaveLength(0);

  // Second tap, with no relay behind the site: kept on the device, and said so.
  await review.getByRole("button", { name: "Send" }).click();
  await expect(card.getByRole("status")).toContainText("saved on this device and will be sent later");
  expect(relay).toHaveLength(1);
  const sent = relay[0] as Record<string, unknown>;
  // Exactly the request and the structure: no records, no code.
  expect(Object.keys(sent).sort()).toEqual(["app", "body", "device", "format", "id", "language", "structure", "title"]);
  expect(sent.title).toBe("Scan barcodes");
  expect(String(sent.structure)).not.toContain("defineApp");
  const kept = await page.evaluate(() => localStorage.getItem("potyro:platform-requests:outbox"));
  expect(JSON.parse(kept ?? "[]")).toHaveLength(1);

  // The relay is back: sent, recorded in the conversation, and nothing left waiting.
  relayUp = true;
  await card.getByRole("button", { name: "Try sending again" }).click();
  await card.getByRole("group", { name: "What will be sent" }).getByRole("button", { name: "Send" }).click();
  await expect(card.getByRole("status")).toContainText("Sent to the Potyro team");
  await expect(card.getByRole("link", { name: "See the request" })).toHaveAttribute("href", "https://github.com/potyro-app/potyro/issues/7");
  await expect(studio.locator(".k-thread-event").last()).toContainText("Sent to the Potyro team: “Scan barcodes”");
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("potyro:platform-requests:outbox"))) ?? "[]")).toHaveLength(0);
  // The same request both times: the relay files a retry once.
  expect((relay[1] as Record<string, unknown>).id).toBe(sent.id);
});
