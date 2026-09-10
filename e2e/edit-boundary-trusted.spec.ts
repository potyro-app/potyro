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

/** Like `stubAgent`, but hands back each scripted reply in the order its generation was
 *  requested — for a flow that makes more than one agent call (an edit, then its repair). Each
 *  POST gets its own job id, and the GET that polls that id is answered from `replies` by index,
 *  so a repair's reply can never be served to the edit that came before it. */
async function stubAgentSequence(page: Page, replies: string[]): Promise<string[]> {
  const prompts: string[] = [];
  await page.route("**/__generate**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      prompts.push((req.postDataJSON() as { prompt: string }).prompt);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: `job-${prompts.length}` }) });
      return;
    }
    const id = new URL(req.url()).searchParams.get("id") ?? "";
    const index = Number(id.replace("job-", "")) - 1;
    if (index >= replies.length) {
      // A call the test didn't script — fail loudly rather than serving stale/empty text, so an
      // unexpected extra model call (a regression that retries when it shouldn't) is diagnosable
      // instead of masquerading as some other assertion failing downstream.
      await route.fulfill({ status: 500, contentType: "text/plain", body: "stub ran out of scripted replies" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "done", text: replies[index] }) });
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

// The same real app-level change, arriving in the shape the contract asks for: prose plus ONE
// SEARCH/REPLACE block. Edit mode has to apply it to the FILE — substituting the lines the model
// named and leaving every other line exactly as it was, which is the whole point of edits.
test("an edit-block reply is applied to the file, not the whole file", async ({ page }) => {
  await seedApp(page);
  const PAGES_LINE = APP_SOURCE.split("\n")[10]!;
  const PLACE_LINE = APP_SOURCE.split("\n")[8]!;
  expect(PAGES_LINE).toContain('title: "Map"'); // the fixture still looks the way this edit expects
  expect(PLACE_LINE).toContain("place: {");
  await stubAgent(
    page,
    [
      "I renamed the page.",
      "```ts",
      "<<<<<<< SEARCH",
      PAGES_LINE,
      "=======",
      PAGES_LINE.replace('title: "Map"', 'title: "Where I have been"'),
      ">>>>>>> REPLACE",
      "```",
    ].join("\n"),
  );
  await page.goto("/?user=pins");
  await expect(page.locator("h1")).toHaveText("Pins");

  await askToChangeTheMap(page, "call the page Where I have been");

  // Same route as the whole-file test below: Edit mode reloads once the version is saved.
  const savedSource = () =>
    page
      .evaluate(() => (JSON.parse(localStorage.getItem("karta:user-apps")!) as { source: string }[])[0]!.source)
      .catch(() => "");
  await expect.poll(savedSource, { timeout: 30_000 }).toContain('title: "Where I have been"');

  // Then wait for the reload to land before reading once, unguarded. The poll above is satisfied the
  // instant `saveUserApp` writes localStorage — which `applyModify` does just BEFORE calling
  // `location.reload()` — so a plain read straight after it lands inside the reload window, and
  // `page.evaluate` throws there. `savedSource`'s `.catch(() => "")` is right for a poll (an empty
  // result just retries) and wrong for a one-shot read: it turned that navigation race into `""`,
  // failing the line below with a whole-source diff against an empty string. That is the flake seen
  // once under a loaded full-suite run and never when this spec ran alone.
  await expect(page.locator(".k-modifydialog")).toHaveCount(0, { timeout: 30_000 });
  const saved = await page.evaluate(
    () => (JSON.parse(localStorage.getItem("karta:user-apps")!) as { source: string }[])[0]!.source,
  );
  // The proof that this was an EDIT and not a rewrite: the untouched lines are byte-identical, and
  // only the one line the model named differs.
  expect(saved).toContain(PLACE_LINE);
  expect(saved).not.toContain('title: "Map"');
  expect(saved).toBe(APP_SOURCE.replace('title: "Map"', 'title: "Where I have been"'));
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
  // History opens on the timeline; the agent's reasoning is inside the version it explains.
  await page.locator(".k-timeline-entry").first().getByRole("button").first().click();
  // The prose is recorded beside the version rather than baked into the module: a causal claim in a
  // comment becomes the next edit's premise, which is how one wrong guess survives three rounds.
  await expect(page.locator(".k-history-rationale")).toContainText("always frame the pins");
  const saved = await page.evaluate(
    () => (JSON.parse(localStorage.getItem("karta:user-apps")!) as { source: string }[])[0]!.source,
  );
  expect(saved).not.toContain("always frame the pins");
});

// Edit mode's repair round now goes through the SAME gate as the edit itself (guardedModify), not a
// second whole-file round trip — see runRepair in App.tsx. What has to hold:
//
//   - a repair that fixes the structure is applied and saved, same as any other edit
//   - a repair that DOESN'T fix it saves nothing — never a broken app with a History entry that
//     looks like a successful one
test("an edit that does not validate is repaired with a second edit, then saved", async ({ page }) => {
  await seedApp(page);
  const PAGES_LINE = APP_SOURCE.split("\n")[10]!;
  expect(PAGES_LINE).toContain('type: "map"'); // the fixture still looks the way this edit expects
  const BROKEN_LINE = PAGES_LINE.replace('type: "map"', 'type: "lisst"');

  const prompts = await stubAgentSequence(page, [
    // The edit: a typo'd view type — this is what makes the app fail structure validation.
    ["I set the view type.", "```ts", "<<<<<<< SEARCH", PAGES_LINE, "=======", BROKEN_LINE, ">>>>>>> REPLACE", "```"].join("\n"),
    // The repair: the exact inverse edit, so the saved app comes back byte-identical to the original.
    ["Fixing the typo.", "```ts", "<<<<<<< SEARCH", BROKEN_LINE, "=======", PAGES_LINE, ">>>>>>> REPLACE", "```"].join("\n"),
  ]);
  await page.goto("/?user=pins");
  await expect(page.locator("h1")).toHaveText("Pins");

  await askToChangeTheMap(page, "change the view type");

  // Wait on the things that only happen once the repaired app is SAVED: the dialog goes away with
  // the reload Edit mode does after saving, and a version appears in History. The byte-equality
  // check cannot stand in for that wait — the seed IS `APP_SOURCE`, so a poll for it is satisfied
  // before the edit has even been requested, and the test would pass with the repair round broken.
  await expect(page.locator(".k-modifydialog")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.locator(".k-timeline-entry")).not.toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "Close history" }).click();

  // Only now is the stored source worth reading: the two edits cancel, so what got saved is exactly
  // what was there before either one ran — read fresh, the way the "saves nothing" test does.
  const stored = await page.evaluate(
    () => (JSON.parse(localStorage.getItem("karta:user-apps")!) as { source: string }[])[0]!.source,
  );
  expect(stored).toBe(APP_SOURCE);

  // Two agent calls happened — the edit, then the repair — and the repair prompt is the validator's
  // own words, not a rewritten whole-file request.
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Fix exactly these problems");
  // The validator's message names the PATH, not the bad value (`pages.N.view.type: Invalid
  // discriminator value. Expected …`) — so this checks for the path segment, not the literal "lisst".
  expect(prompts[1]).toContain("view.type");
});

test("a repair that still does not validate saves nothing", async ({ page }) => {
  await seedApp(page);
  const PAGES_LINE = APP_SOURCE.split("\n")[10]!;
  expect(PAGES_LINE).toContain('type: "map"');
  const BROKEN_LINE = PAGES_LINE.replace('type: "map"', 'type: "lisst"');
  // The repair changes something real, but never touches the typo it was asked to fix.
  const STILL_BROKEN_LINE = BROKEN_LINE.replace('title: "Map"', 'title: "Somewhere"');

  const prompts = await stubAgentSequence(page, [
    ["I set the view type.", "```ts", "<<<<<<< SEARCH", PAGES_LINE, "=======", BROKEN_LINE, ">>>>>>> REPLACE", "```"].join("\n"),
    ["I renamed the page instead.", "```ts", "<<<<<<< SEARCH", BROKEN_LINE, "=======", STILL_BROKEN_LINE, ">>>>>>> REPLACE", "```"].join(
      "\n",
    ),
  ]);
  await page.goto("/?user=pins");
  await expect(page.locator("h1")).toHaveText("Pins");

  await askToChangeTheMap(page, "change the view type");

  const error = page.locator(".k-form-error");
  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(error).toContainText(/^Nothing was saved/);

  // The repair round actually ran — not skipped, with some other look-alike "Nothing was saved"
  // error standing in for it undetected.
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Fix exactly these problems");

  // Still on the broken-attempt app: no version was appended…
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.locator(".k-timeline-entry")).toHaveCount(0);
  await page.getByRole("button", { name: "Close history" }).click();

  // …and the source on disk is untouched, byte for byte.
  const stored = await page.evaluate(
    () => (JSON.parse(localStorage.getItem("karta:user-apps")!) as { source: string }[])[0]!.source,
  );
  expect(stored).toBe(APP_SOURCE);
});
