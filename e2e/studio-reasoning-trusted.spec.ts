import { test, expect, type Page } from "@playwright/test";
import { ask, currentCard, openFromCard, openNewStudio } from "./studio-helpers.js";

// #280: how hard the model thinks is chosen in Model settings, and it reaches the requests the
// Studio sends — create and modify alike — with the token budget raised to match, so the thinking
// cannot leave the answer empty. Scripted OpenRouter; the request bodies are what is checked.
// Fails if the setting is only shown and never sent.

const APP =
  'import { defineApp } from "potyro";\nexport default defineApp({\n  id: "reader",\n  name: "Reader",\n  version: "1.0.0",\n  schemaVersion: 1,\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },\n  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],\n});';

const EDITS =
  'Adding the rating.\n```ts\n<<<<<<< SEARCH\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },\n=======\n  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true }, rating: { type: "number", min: 0, max: 5 } } } },\n>>>>>>> REPLACE\n```';

type Body = { reasoning?: { effort?: string }; max_tokens?: number };

const settings = (page: Page) => page.getByRole("dialog", { name: "Model settings" });

test("the level chosen in Model settings reaches create and modify, with the budget to match", async ({ page }) => {
  const bodies: Body[] = [];
  const reply = (message: Record<string, unknown>) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });
  await page.route("**/openrouter.ai/**", async (route) => {
    bodies.push(route.request().postDataJSON() as Body);
    return route.fulfill(reply({ content: bodies.length === 1 ? "```ts\n" + APP + "\n```" : EDITS }));
  });

  const studio = await openNewStudio(page);
  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = settings(page);
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await modal.getByLabel("OpenRouter API key").fill("sk-or-stub");
  const levels = modal.getByRole("radiogroup", { name: "How hard it thinks" });
  // Off until the person says otherwise, and the escalation on.
  await expect(levels.getByRole("radio", { name: /^Off/ })).toBeChecked();
  await expect(modal.getByRole("checkbox", { name: /Think hard when stuck/ })).toBeChecked();
  await levels.getByRole("radio", { name: /^High/ }).check();
  await expect(modal.getByText(/thinks hard/).first()).toBeVisible();
  await modal.getByRole("button", { name: "Close model settings" }).click();

  await ask(studio, "a reading tracker");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });
  await ask(studio, "add a 5-star rating field");
  await expect(currentCard(studio).locator(".k-card-what")).toHaveText(/Applied 1 edit/, { timeout: 60_000 });

  expect(bodies.length).toBeGreaterThanOrEqual(2);
  for (const b of bodies) {
    expect(b.reasoning?.effort).toBe("high");
    expect(b.max_tokens).toBe(64_000);
  }
});

test("off sends what the Studio always sent: reasoning none, the usual budget", async ({ page }) => {
  const bodies: Body[] = [];
  await page.route("**/openrouter.ai/**", async (route) => {
    bodies.push(route.request().postDataJSON() as Body);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "```ts\n" + APP + "\n```" } }] }) });
  });
  const studio = await openNewStudio(page);
  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = settings(page);
  await modal.getByRole("radio", { name: /OpenRouter/ }).check();
  await modal.getByLabel("OpenRouter API key").fill("sk-or-stub");
  await modal.getByRole("button", { name: "Close model settings" }).click();
  await ask(studio, "a reading tracker");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText("Reader", { timeout: 60_000 });
  expect(bodies[0]).toMatchObject({ reasoning: { effort: "none" }, max_tokens: 32_000 });
});
