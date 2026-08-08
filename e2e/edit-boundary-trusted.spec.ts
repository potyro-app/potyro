import { test, expect, type Page } from "@playwright/test";

// Edit mode's escape hatch, end to end.
//
// "Fix with AI" can only rewrite the app module. When a complaint is really about how a built-in view
// behaves, the honest answer is "this isn't in your app" — and the contract now makes that a legal
// reply (`NOT-IN-APP:`) instead of forcing a fabricated edit. What has to hold:
//
//   - the diagnosis is shown, and NOT as an error
//   - no version is appended, because no source changed
//   - it is remembered, and fed back so the next attempt doesn't retry the same dead end
//
// The model is stubbed at the dev generator endpoint, so this exercises the whole real loop —
// prompt assembly, reply parsing, storage, panels — deterministically and without a model call.

const APP_SOURCE = `import { defineApp } from "karta";

export default defineApp({
  id: "pins",
  name: "Pins",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    place: { label: "Place", displayField: "name", fields: { name: { type: "text", required: true }, loc: { type: "geo" } } },
  },
  pages: [{ id: "map", title: "Map", view: { type: "map", entity: "place", geo: "loc", title: "name" } }],
});
`;

const DIAGNOSIS =
  "NOT-IN-APP: the map's opening camera is owned by the built-in map view, not by this module. " +
  "A `map` view can declare entity, geo, title, color, filter, filters, onOpen and camera — nothing " +
  "here controls load order. Fixing it means changing packages/views/src/map.tsx.";

/** Stand in for the dev generator: capture the prompt, reply with a fixed text. */
async function stubAgent(page: Page, reply: string): Promise<string[]> {
  const prompts: string[] = [];
  await page.route("**/__generate**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      prompts.push((req.postDataJSON() as { prompt: string }).prompt);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "job-1" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "done", text: reply }) });
  });
  return prompts;
}

async function seedApp(page: Page): Promise<void> {
  // Seed once, not on every navigation: Edit mode reloads the page after saving, and re-seeding
  // there would overwrite the very edit under test with the original source.
  await page.addInitScript((source) => {
    if (localStorage.getItem("karta:user-apps")) return;
    localStorage.setItem(
      "karta:user-apps",
      JSON.stringify([{ id: "pins", name: "Pins", source, updatedAt: new Date(0).toISOString(), trusted: true }]),
    );
  }, APP_SOURCE);
}

async function askToChangeTheMap(page: Page, text: string): Promise<void> {
  // Edit mode is a toggle — clicking it again when already on turns the edit marks off.
  const toggle = page.getByRole("button", { name: "Edit mode" });
  if ((await toggle.getAttribute("data-active")) !== "true") await toggle.click();
  await page.locator(".k-editmark").first().click();
  await page.getByLabel("Describe the change").fill(text);
  await page.getByRole("button", { name: "Apply with AI" }).click();
}

test("a host-side cause is reported, not faked as an app edit", async ({ page }) => {
  await seedApp(page);
  const prompts = await stubAgent(page, DIAGNOSIS);
  await page.goto("/?user=pins");
  await expect(page.locator("h1")).toHaveText("Pins");

  await askToChangeTheMap(page, "it should open where I left it, not on the whole world");

  // Shown, and shown as an answer rather than a failure — an error style would read as "retry me",
  // which is how the same wrong edit gets requested five times.
  const diagnosis = page.locator(".k-diagnosis");
  await expect(diagnosis).toBeVisible();
  await expect(diagnosis).toContainText("built-in map view");
  await expect(page.locator(".k-form-error")).toHaveCount(0);
  // The marker itself is protocol, not prose — it must never reach the user.
  await expect(diagnosis).not.toContainText("NOT-IN-APP:");

  // The app is untouched: still on the page, and its source is byte-identical.
  await expect(page.locator("h1")).toHaveText("Pins");
  const stored = await page.evaluate(
    () => (JSON.parse(localStorage.getItem("karta:user-apps")!) as { source: string }[])[0]!.source,
  );
  expect(stored).toBe(APP_SOURCE);

  // The agent was told what a `map` view can declare — the boundary it needs to answer honestly.
  expect(prompts[0]).toContain("camera?");
  expect(prompts[0]).toContain("belongs to the host");
});

test("the diagnosis is remembered, and the next attempt is told about it", async ({ page }) => {
  await seedApp(page);
  const prompts = await stubAgent(page, DIAGNOSIS);
  await page.goto("/?user=pins");
  await expect(page.locator("h1")).toHaveText("Pins");

  await askToChangeTheMap(page, "it should open where I left it");
  await expect(page.locator(".k-diagnosis")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // History records that this was looked at and deliberately not changed — but writes no version,
  // because a version the user cannot diff is a lie about what happened.
  await page.getByRole("button", { name: "History" }).click();
  const panel = page.locator(".k-history-diagnoses");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("built-in map view");
  await expect(page.locator(".k-history-item")).toHaveCount(0);
  await page.getByRole("button", { name: "Close history" }).click();

  // Asking again must not start from a blank slate — that is how the same dead end gets retried.
  await askToChangeTheMap(page, "seriously, remember my zoom");
  await expect(page.locator(".k-diagnosis")).toBeVisible();
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Already reported as host-side");
  expect(prompts[1]).toContain("built-in map view");
});

test("a real app-level change still applies, and its reasoning is kept out of the source", async ({ page }) => {
  await seedApp(page);
  const edited = APP_SOURCE.replace('title: "name"', 'title: "name", camera: "fit"');
  await stubAgent(page, `I set the map's camera to always frame the pins.\n\n\`\`\`ts\n${edited}\n\`\`\``);
  await page.goto("/?user=pins");
  await expect(page.locator("h1")).toHaveText("Pins");

  await askToChangeTheMap(page, "always zoom to fit all the pins");

  // Edit mode reloads the app once the version is saved.
  // Generous: this waits on a stubbed round trip, a validate + save, and a full page reload, which
  // under a loaded parallel run can outrun the default expect timeout.
  await expect
    .poll(
      async () =>
        page
          .evaluate(() => (JSON.parse(localStorage.getItem("karta:user-apps")!) as { source: string }[])[0]!.source)
          .catch(() => ""),
      { timeout: 30_000 },
    )
    .toContain('camera: "fit"');

  await page.getByRole("button", { name: "History" }).click();
  // The prose is recorded beside the version rather than baked into the module: a causal claim in a
  // comment becomes the next edit's premise, which is how one wrong guess survives three rounds.
  await expect(page.locator(".k-history-rationale")).toContainText("always frame the pins");
  const saved = await page.evaluate(
    () => (JSON.parse(localStorage.getItem("karta:user-apps")!) as { source: string }[])[0]!.source,
  );
  expect(saved).not.toContain("always frame the pins");
});
