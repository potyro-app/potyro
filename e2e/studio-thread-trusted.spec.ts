import { test, expect, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";

// The Studio as a conversation, and copying an app (#218).
//
// Both reported together, from a real session: "when you type the prompt to create or modify an
// app, the text area remains with the last prompt, if I want to modify I need to manually select
// all, delete and write a new prompt" — and, after someone had to fork Split by copying its source
// out of the Studio and pasting it back, "there is no way to copy an app, like a fork".
//
// Every version already stored the prompt that produced it, so the thread is that material read as
// a conversation rather than a list of versions.

const APP = (title: string) => `import { defineApp } from "potyro";

export default defineApp({
  id: "notes",
  name: "Notes",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    note: { label: "Note", displayField: "title", fields: { title: { type: "text", required: true } } },
  },
  pages: [
    { id: "all", title: ${JSON.stringify(title)}, view: { type: "list", entity: "note", display: { primary: "title" } } },
  ],
});
`;

/** The dev server's generate endpoint, handing out canned sources in order. */
async function stubGenerator(page: Page, sources: string[]): Promise<void> {
  const queue = [...sources];
  const jobs = new Map<string, string>();
  let served = 0;
  await page.route("**/__generate**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const source = queue.shift();
      if (source === undefined) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "out of sources" }) });
      const id = `job-${++served}`;
      jobs.set(id, source);
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id }) });
    }
    const id = new URL(request.url()).searchParams.get("id") ?? "";
    const source = jobs.get(id);
    if (source === undefined) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "unknown job" }) });
    jobs.delete(id);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "done", text: "```ts\n" + source + "```\n" }) });
  });
}

async function seedApp(page: Page): Promise<void> {
  await page.addInitScript(
    (source) => {
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "notes", name: "Notes", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
      localStorage.setItem("potyro:generator:engine", JSON.stringify({ engine: "cli" }));
    },
    APP("Notes"),
  );
}

const studio = (page: Page) => page.locator(".k-studio");

test("the prompt box empties on submit and the ask joins the thread", async ({ page }) => {
  test.slow();
  await seedApp(page);
  await stubGenerator(page, [APP("Jotter")]);

  await page.goto("/?user=notes");
  await expect(page.locator("h1").first()).toHaveText("Notes", { timeout: 30_000 });
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(studio(page)).toBeVisible();

  const box = studio(page).getByRole("textbox", { name: "Describe the app" });
  await box.fill("rename the page to Jotter");
  await studio(page).getByRole("button", { name: /Modify the app/ }).click();

  // The box is empty the moment the ask is sent — that is the point. Before this it kept the last
  // prompt, so the next change began with select-all and delete.
  await expect(box).toHaveValue("", { timeout: 30_000 });

  // And what was asked is on screen, where it can be read back.
  const thread = studio(page).locator(".k-thread");
  await expect(thread).toContainText("rename the page to Jotter", { timeout: 60_000 });
  // With an answer under it once the model has been heard from.
  await expect(thread.locator(".k-thread-answer")).not.toHaveText("Working…", { timeout: 60_000 });
});

test("reopening an app shows what was asked of it before", async ({ page }) => {
  test.slow();
  await seedApp(page);
  await stubGenerator(page, [APP("Jotter")]);

  await page.goto("/?user=notes");
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await studio(page).getByRole("textbox", { name: "Describe the app" }).fill("rename the page to Jotter");
  await studio(page).getByRole("button", { name: /Modify the app/ }).click();
  // Wait for the ANSWER, not just the ask: the ask appears the instant it is sent, and saving
  // while the model is still working saves the source it has not changed yet.
  await expect(studio(page).locator(".k-thread-answer").last()).not.toHaveText("Working…", { timeout: 60_000 });
  await studio(page).getByRole("button", { name: /Save changes/ }).first().click();
  // The save writes a version; let it land before the Studio is torn down.
  await expect(studio(page).getByText(/Saved|My Apps/).first()).toBeVisible({ timeout: 30_000 });

  // Close the Studio, come back to it: the thread is read from the app's own history, so it
  // survives — this is not session state.
  await studio(page).getByRole("button", { name: /Close studio/ }).click();
  await page.getByRole("button", { name: "Studio", exact: true }).click();

  await expect(studio(page).locator(".k-thread")).toContainText("rename the page to Jotter", { timeout: 30_000 });
  // Finished, not pending: it was saved. Read back, it used to show "Working…" for ever.
  await expect(studio(page).locator(".k-thread")).not.toContainText("Working…");
});

test("a change that wasn't a request reads as something that happened, never as waiting", async ({ page }) => {
  // Reported on apps.vaz.io: a shared app's Studio showed "shared with you" and under it "Working…",
  // for ever. Any version that was not a model request — arriving from someone, a rollback, a hand
  // edit — was shown as a question with no answer. A hand edit is the one a test can make here.
  await seedApp(page);
  await page.goto("/?user=notes");
  await expect(page.locator("h1").first()).toHaveText("Notes", { timeout: 30_000 });

  // Rename the tab in edit mode: saved as an `adjusted` version, with a note.
  await page.getByRole("button", { name: "Edit mode" }).click();
  const tab = page.locator(".k-nav .k-tab-label", { hasText: "Notes" }).first();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const h = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("k-editable");
        return h ? [...h].some((r) => r.toString().trim() === "Notes") : false;
      }),
    )
    .toBe(true);
  const box = (await tab.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const pop = page.getByRole("dialog", { name: "Change page name" });
  await pop.getByRole("textbox").fill("Jottings");
  await pop.getByRole("button", { name: "Save" }).click();
  await expect(pop).toHaveCount(0);
  // The rename is a version now. (`seedApp` re-seeds the source on every load, so the reload that
  // "Done" does would put the old name back on screen — History is what this is about.)
  const MARK = "__potyro_pre_reload";
  await page.evaluate((key: string) => ((globalThis as Record<string, unknown>)[key] = true), MARK);
  await page.locator(".k-inline-bar").getByRole("button", { name: "Done" }).click();
  await expect
    .poll(() => page.evaluate((key: string) => (globalThis as Record<string, unknown>)[key] === undefined, MARK).catch(() => false), { timeout: 30_000 })
    .toBe(true);
  await expect(page.locator("h1").first()).toHaveText("Notes", { timeout: 30_000 });

  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(studio(page).locator(".k-thread-event", { hasText: "Jottings" })).toBeVisible({ timeout: 30_000 });
  await expect(studio(page).locator(".k-thread")).not.toContainText("Working…");
  // An event, not an exchange: no question bubble made out of it.
  await expect(studio(page).locator(".k-thread-ask", { hasText: "Jottings" })).toHaveCount(0);
});

test("Save is refused while the model is still working", async ({ page }) => {
  // Saving mid-answer saves the app as it WAS, under a version that records the prompt — so the app
  // is left with a version claiming a change it does not contain. My own test did this by accident;
  // a person clicking Save while the spinner runs does the same thing.
  test.slow();
  await seedApp(page);
  await stubGenerator(page, [APP("Jotter")]);

  await page.goto("/?user=notes");
  await expect(page.locator("h1").first()).toHaveText("Notes", { timeout: 30_000 });
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await studio(page).getByRole("textbox", { name: "Describe the app" }).fill("rename the page to Jotter");

  const save = studio(page).getByRole("button", { name: /Save changes/ }).first();
  await expect(save).toBeEnabled();
  await studio(page).getByRole("button", { name: /Modify the app/ }).click();
  await expect(save).toBeDisabled();

  // And it comes back once the answer has landed.
  await expect(studio(page).locator(".k-thread-answer").last()).not.toHaveText("Working…", { timeout: 60_000 });
  await expect(save).toBeEnabled({ timeout: 30_000 });
});

test("an app can be duplicated from the launcher", async ({ page }) => {
  await seedApp(page);
  await page.goto("/?user=notes");
  await expect(page.locator("h1").first()).toHaveText("Notes", { timeout: 30_000 });

  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(page, "Notes", "duplicate");

  // Said out loud, naming the copy and what it did not bring with it.
  const dialog = page.locator(".k-dialog");
  await expect(dialog).toContainText("Notes (copy)");
  await expect(dialog).toContainText("starts empty");
  await dialog.getByRole("button", { name: "Confirm" }).click();

  // Two apps now, and the original is still there beside the copy.
  await expect(page.getByRole("button", { name: "Actions for Notes (copy)" })).toBeVisible();
  // `exact`: without it "Actions for Notes" also matches the copy.
  await expect(page.getByRole("button", { name: "Actions for Notes", exact: true })).toBeVisible();
});
