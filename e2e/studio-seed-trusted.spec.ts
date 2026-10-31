import { test, expect, type Locator, type Page } from "./console-guard";
import { makeDemoLink, stranger } from "./share-demo";
import { ask, openFromCard, openNewStudio } from "./studio-helpers.js";

// An app made in the Studio keeps sample records (#486): once its app passed its run, the create loop
// asks the model once more for plausible records in its shape, and a link anyone can try opens on them
// on a device that never had it — never on "Nothing here yet", never on the run's own made-up rows
// ("name 1"), and never with the maker's own records. Nothing reaches a model: the relay's chat route
// is faked at the browser's edge, as free-path-trusted.spec.ts fakes it — the app below for the create,
// the rows below for the one request for sample records (told apart by its system prompt). One of the
// rows does not fit the app (no such date) and is dropped.

const MODEL = "deepseek/deepseek-v4-flash-0731";
const APP_NAME = "Watering";
const MINE = "Lemon tree on the balcony";
const APP = `import { defineApp } from "potyro";

export default defineApp({
  id: "watering",
  name: "${APP_NAME}",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    plant: {
      label: "Plant",
      displayField: "name",
      fields: {
        name: { type: "text", label: "Plant", required: true },
        watered: { type: "datetime", label: "Last watered" },
      },
    },
  },
  pages: [{ id: "all", title: "My plants", view: { type: "list", entity: "plant", display: { primary: "name", secondary: "watered" } } }],
});
`;

const SAMPLES = ["Monstera by the window", "Lemon tree on the terrace", "Basil in the kitchen"];
const UNFIT = "Fern that never was";
const SAMPLE_REPLY = JSON.stringify({
  plant: [
    { id: "plant-1", name: SAMPLES[0], watered: "2026-10-28" },
    { id: "plant-2", name: SAMPLES[1], watered: "2026-10-30" },
    { id: "plant-3", name: SAMPLES[2] },
    { id: "plant-4", name: UNFIT, watered: "not a date" },
  ],
});

async function fakeRelay(page: Page): Promise<{ sampleCalls: () => number }> {
  let sampleCalls = 0;
  await page.route("**/ai/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, chat: true, model: MODEL }) }));
  await page.route("**/ai/v1/chat/completions", (route) => {
    const asksForSamples = (route.request().postData() ?? "").includes("You write sample records");
    if (asksForSamples) sampleCalls++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-potyro-left-usd": "0.48" },
      body: JSON.stringify({
        choices: [{ message: { role: "assistant", content: asksForSamples ? SAMPLE_REPLY : "```ts\n" + APP + "```" }, finish_reason: "stop" }],
        usage: { cost: 0.004 },
      }),
    });
  });
  await page.route("**/ai/count", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  return { sampleCalls: () => sampleCalls };
}

async function choosePotyro(page: Page, studio: Locator): Promise<void> {
  await studio.getByRole("button", { name: "Model settings" }).click();
  const modal = page.getByRole("dialog", { name: "Model settings" });
  await modal.getByRole("radio", { name: /^Potyro/ }).check();
  await modal.getByRole("button", { name: "Close model settings" }).click();
  await expect(modal).toBeHidden();
}

test("an app made in the Studio: its link anyone can try opens on sample records, none of the maker's", async ({ page, browser, baseURL }) => {
  const relay = await fakeRelay(page);
  const studio = await openNewStudio(page);
  await choosePotyro(page, studio);
  await ask(studio, "a list of the plants I water and when");
  const preview = await openFromCard(studio);
  await expect(preview.locator("h1").first()).toHaveText(APP_NAME, { timeout: 60_000 });
  // The maker's own app starts empty: the sample records are for the link, not put into their data.
  await expect(preview.getByText("Nothing here yet.")).toBeVisible();
  // One request for them, after the app passed its run.
  expect(relay.sampleCalls()).toBe(1);

  // A record of their own, which must never travel.
  await preview.getByRole("button", { name: "Add: Plant" }).first().click();
  const form = page.getByRole("dialog", { name: "Add: Plant" });
  await form.getByLabel("Plant").fill(MINE);
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form).toBeHidden();
  await expect(preview.getByText(MINE)).toBeVisible();
  await studio.getByRole("button", { name: "Close studio" }).click();
  await expect(studio).toHaveCount(0);

  // The share sheet says the link opens on sample records, and the link carries them.
  const link = await makeDemoLink(page, APP_NAME);
  await expect(page.locator(".k-share-sheet [data-share-opens]")).toHaveAttribute("data-share-opens", "samples");

  // A device that has never used Potyro opens it: sealed, on the sample records the model wrote.
  const { context, page: viewer } = await stranger(browser, baseURL!);
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(viewer.locator("h1").first()).toHaveText(APP_NAME);
  for (const sample of SAMPLES) await expect(viewer.getByText(sample, { exact: true })).toBeVisible();
  // Never the run's own made-up rows, and never a row that did not fit the app.
  await expect(viewer.getByText("name 1", { exact: true })).toHaveCount(0);
  await expect(viewer.getByText(UNFIT)).toHaveCount(0);
  await expect(viewer.getByText("Nothing here yet.")).toHaveCount(0);
  await expect(viewer.getByText(MINE)).toHaveCount(0);
  expect(decodeURIComponent(link)).not.toContain(MINE);
  await context.close();
});
