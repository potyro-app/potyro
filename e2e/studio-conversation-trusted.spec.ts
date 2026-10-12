import { test, expect, type Page } from "@playwright/test";
import { ask, currentCard, openNewStudio } from "./studio-helpers.js";

// Making an app is a conversation, and the conversation is kept (#261).
//
//  - The agent may ask before it builds, and the answer reaches it beside its own question.
//  - A conversation left before anything was made is an unfinished app on the home screen, until
//    the person deletes it — kept and unreachable would be worse than not kept.
//  - How an app was made can travel with it, when the person says so.

const APP = `import { defineApp } from "potyro";

export default defineApp({
  id: "plant-diary",
  name: "Plant Diary",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { plant: { label: "Plant", displayField: "name", fields: { name: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Plants", view: { type: "list", entity: "plant", display: { primary: "name" } } }],
});
`;

/** The dev server's generate endpoint: canned replies in order, and every prompt it was sent. */
async function stubGenerator(page: Page, replies: string[]): Promise<string[]> {
  const queue = [...replies];
  const prompts: string[] = [];
  const jobs = new Map<string, string>();
  let n = 0;
  await page.route("**/__generate**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      prompts.push((request.postDataJSON() as { prompt: string }).prompt);
      const id = `job-${++n}`;
      jobs.set(id, queue.shift() ?? "QUESTION: (out of replies)");
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id }) });
    }
    const id = new URL(request.url()).searchParams.get("id") ?? "";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "done", text: jobs.get(id) ?? "" }) });
  });
  return prompts;
}

const cli = (page: Page) => page.addInitScript(() => localStorage.setItem("potyro:generator:engine", JSON.stringify({ engine: "cli" })));

test("the agent asks first; leaving is an unfinished app on the home screen; picking it up finishes it", async ({ page }) => {
  await cli(page);
  const prompts = await stubGenerator(page, ["QUESTION: Indoor plants, or a garden?", "```ts\n" + APP + "```"]);

  let studio = await openNewStudio(page);
  await ask(studio, "something to remember when to water my plants");
  await expect(studio.locator('.k-thread-answer[data-tone="question"]')).toContainText("Indoor plants, or a garden?", { timeout: 30_000 });
  // Nothing was made for a question.
  await expect(studio.locator(".k-card")).toHaveCount(0);

  // Leave. The conversation is on the home screen, and stays there across a reload.
  await studio.getByRole("button", { name: "Close studio" }).click();
  const draft = page.getByRole("button", { name: "Continue “something to remember when to water my plants”" });
  await expect(draft).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(draft).toBeVisible({ timeout: 30_000 });

  // Pick it up where it was left: the question is there, and answering it makes the app.
  await draft.click();
  studio = page.locator(".k-studio");
  await expect(studio.locator('.k-thread-answer[data-tone="question"]')).toContainText("Indoor plants, or a garden?", { timeout: 30_000 });
  await ask(studio, "indoor, on the windowsills");
  await expect(currentCard(studio).locator(".k-card-name")).toContainText("Plant Diary", { timeout: 60_000 });

  // The answer reached the model beside the question it answers, with the request that started it.
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("something to remember when to water my plants");
  expect(prompts[1]).toContain("You asked: Indoor plants, or a garden?");
  expect(prompts[1]).toContain("The answer: indoor, on the windowsills");

  // Made: no longer unfinished — it is an app.
  await studio.getByRole("button", { name: "Close studio" }).click();
  await expect(page.locator(".k-drafts")).toHaveCount(0);
  await expect(page.locator(".k-launch-tile", { hasText: "Plant Diary" })).toBeVisible();
});

test("an unfinished app is deleted only when the person says so", async ({ page }) => {
  await cli(page);
  await stubGenerator(page, ["QUESTION: Indoor plants, or a garden?"]);
  const studio = await openNewStudio(page);
  await ask(studio, "plants");
  await expect(studio.locator('.k-thread-answer[data-tone="question"]')).toBeVisible({ timeout: 30_000 });
  await studio.getByRole("button", { name: "Close studio" }).click();

  const del = page.getByRole("button", { name: "Delete “plants”" });
  await del.click();
  const dialog = page.locator(".k-dialog");
  await expect(dialog).toContainText("Delete “plants”?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(del).toBeVisible();

  await del.click();
  await page.locator(".k-dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".k-drafts")).toHaveCount(0);
});

test("how an app was made goes with it only when asked, and arrives as the receiver's conversation", async ({ page, browser }) => {
  // The download needs the <a download> fallback headless Chromium can capture.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await cli(page);
  await stubGenerator(page, ["```ts\n" + APP + "```"]);
  await page.setViewportSize({ width: 1280, height: 800 });
  const studio = await openNewStudio(page);
  await ask(studio, "a diary for my plants");
  await expect(currentCard(studio)).toBeVisible({ timeout: 60_000 });
  await studio.getByRole("button", { name: "Close studio" }).click();

  // Export asks first, in words that say whose words go.
  await page.goto("/?user=plant-diary");
  await expect(page.locator("h1").first()).toHaveText("Plant Diary", { timeout: 30_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const question = page.locator(".k-dialog");
  await expect(question).toContainText("Include how this app was made?");
  await expect(question).toContainText("in your own words");
  await question.getByRole("button", { name: "Include it" }).click();
  const bundle = await (await download).path();

  // Someone else's device: add it from the file, and its Studio has the author's conversation.
  const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const theirs = await other.newPage();
  await theirs.goto("/");
  await theirs.getByRole("button", { name: "Add an app" }).click();
  const add = theirs.getByRole("dialog", { name: "Add an app" });
  const chooser = theirs.waitForEvent("filechooser");
  await add.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles({ name: "plant-diary.potyro.zip", mimeType: "application/zip", buffer: await import("node:fs").then((fs) => fs.readFileSync(bundle)) });
  await expect(add.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  await add.getByRole("button", { name: "Add app" }).click();
  await expect(theirs.locator("h1").first()).toHaveText("Plant Diary", { timeout: 30_000 });

  await theirs.locator(".k-tools").getByRole("button", { name: "Studio" }).click();
  const thread = theirs.locator(".k-studio .k-thread");
  await expect(thread).toContainText("a diary for my plants", { timeout: 30_000 });
  await expect(thread.locator(".k-thread-event").last()).toContainText("as shared by its author");
  await other.close();
});
