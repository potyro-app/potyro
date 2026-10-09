import { test, expect } from "@playwright/test";

// App history: what a change did to an app, and the way back from it.
//
// An edit rewrites the whole app module, so without a version log the user cannot see what changed
// and a bad edit is permanent. This drives the real thing in a browser — save a change in the
// Studio, read the diff in History, roll back — because that whole chain (Store write → diff render
// → restore → reload) only exists in the browser. The model is never called: the Studio's source
// editor produces a real edit deterministically.

const STARTER = `import { defineApp } from "potyro";

export default defineApp({
  id: "history-target",
  name: "History Target",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    note: {
      label: "Note",
      icon: "📝",
      displayField: "title",
      fields: { title: { type: "text", required: true } },
    },
  },
  pages: [
    { id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" } } },
  ],
});
`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([source]) => {
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([
          { id: "history-target", name: "History Target", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER],
  );
});

test("a saved change is diffable and reversible", async ({ page }) => {
  await page.goto("/?user=history-target");
  await expect(page.locator("h1").first()).toHaveText("History Target", { timeout: 30_000 });

  // 1. Make a real, model-free change: rename the page in the Studio's source editor and save.
  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  await expect(studio).toBeVisible();
  await studio.getByRole("button", { name: "History Target", exact: true }).click();

  await studio.getByRole("tab", { name: "Source" }).click();
  const source = studio.getByRole("textbox", { name: "App source" });
  await expect(source).toContainText('title: "Notes"', { timeout: 30_000 });
  await source.fill(STARTER.replace('title: "Notes"', 'title: "Journal"'));
  await studio.getByRole("button", { name: "Save changes" }).click();

  // 2. History is a TAB beside Preview and Source — one click, at the same altitude as the app — and
  //    it opens on the timeline with no diff in sight.
  await studio.getByRole("tab", { name: "History" }).click();
  const history = studio.locator(".k-studio-history");
  await expect(history).toBeVisible();
  const entry = (seq: string) =>
    history.locator(".k-timeline-entry").filter({ has: page.locator(".k-history-seq", { hasText: seq }) });
  await expect(entry("v2")).toBeVisible({ timeout: 30_000 });
  await expect(entry("v1")).toBeVisible();

  // The whole point of the layout: every version is listed, and NOTHING is expanded. This used to
  // auto-select the newest, so a diff took the screen before you had asked for one — and on a narrow
  // window it pushed the list of versions off the top entirely.
  const diff = history.locator(".k-diff");
  await expect(diff).toHaveCount(0);

  // 3. Clicking a version — and only then — shows what it changed.
  await entry("v2").getByRole("button").first().click();
  await expect(diff.locator(".k-diff-add")).toContainText('title: "Journal"');
  await expect(diff.locator(".k-diff-del")).toContainText('title: "Notes"');
  // Only the changed line and its context — not the whole file.
  await expect(diff.locator(".k-diff-add")).toHaveCount(1);
  await expect(diff.locator(".k-diff-del")).toHaveCount(1);

  // Clicking it again closes it: the timeline is the resting state, not a thing you escape back to.
  await entry("v2").getByRole("button").first().click();
  await expect(diff).toHaveCount(0);

  // 4. Roll back to v1. Opening it shows the diff the other way round — what restoring would undo,
  //    which is the question you're actually asking before you press Restore.
  await entry("v1").getByRole("button").first().click();
  await expect(history.getByText(/vs v2 \(running\)/)).toBeVisible();
  await expect(diff.locator(".k-diff-add")).toContainText('title: "Notes"');
  await expect(diff.locator(".k-diff-del")).toContainText('title: "Journal"');
  await history.getByRole("button", { name: "Restore v1" }).click();

  await expect(page.getByRole("tab", { name: "Notes" }).or(page.getByRole("button", { name: "Notes" })).first())
    .toBeVisible({ timeout: 30_000 });
  const saved = await page.evaluate(() => {
    const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as { id: string; source: string }[];
    return apps.find((a) => a.id === "history-target")?.source ?? "";
  });
  expect(saved).toContain('title: "Notes"');
  expect(saved).not.toContain('title: "Journal"');
});
