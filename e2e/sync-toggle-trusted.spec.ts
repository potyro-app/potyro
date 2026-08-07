import { test, expect } from "@playwright/test";

// Turning sync on for an app, in a real browser (KA-08 / ADR 0001 D3).
//
// This is the acceptance criterion the unit suite cannot be: the two worst bugs in this track —
// `expectCoValueLoaded` on a restored CoValue, and cojson's asynchronous storage flush — BOTH
// passed a fully green Node suite and would have failed on a user's first refresh. Only a test
// that crosses a real process boundary (OPFS + a real page reload) catches that class.
//
// What it drives end to end:
//   seed a local-only app -> add a record -> toggle sync on (migrates SqliteStore -> JazzStore)
//   -> the record survived the migration -> RELOAD -> it is still there, now served by the CRDT
//   store.
//
// ## STATUS: `fixme` — these tests are correct, the FEATURE is not ready.
//
// Running them was worth it: they surfaced the blocker immediately. The toggle reports
//
//     "Could not change sync: Missing required OPFS APIs."
//
// `openJazzStore` requires the OPFS SAH-pool VFS, and headless Chromium does not provide it — nor
// does Firefox. So sync is currently unavailable to a large share of real browsers, and cannot be
// exercised in a browser at all. (The failure at least surfaces LOUDLY in the dialog rather than
// silently degrading, which is the deliberate no-fallback design: falling back to a non-CRDT store
// would look like it worked and then lose a peer's concurrent edits.)
//
// The fix is a non-OPFS storage backend for cojson (IndexedDB), after which these tests should be
// switched from `fixme` to live and will be KA-08's real acceptance criterion. Tracked in
// docs/10-backlog.md#ka-08.

const STARTER = `import { defineApp } from "karta";

export default defineApp({
  id: "sync-target",
  name: "Sync Target",
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
        "karta:user-apps",
        JSON.stringify([
          { id: "sync-target", name: "Sync Target", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER],
  );
});

test.fixme("sync can be turned on, and the app's data comes with it", async ({ page }) => {

  await page.goto("/?user=sync-target");
  await expect(page.locator("h1").first()).toHaveText("Sync Target", { timeout: 30_000 });

  // A record written by the LOCAL store — this is what the migration has to carry across.
  await page.getByRole("button", { name: /New Note|Add Note/i }).first().click();
  await page.getByLabel(/title/i).fill("Before sync");
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(page.locator(".k-list-row", { hasText: "Before sync" })).toBeVisible();

  // Turn sync on from the launcher. This copies the data between two stores that keep it in
  // DIFFERENT files — a bare flag flip would open the app empty.
  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await page.getByRole("button", { name: "Turn on sync for Sync Target" }).click();

  const confirmDialog = page.locator(".k-dialog");
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText("copied into the synced store");
  await confirmDialog.getByRole("button", { name: "Confirm" }).click();

  // The result dialog reports what moved. A silent migration is exactly what we do not want.
  await expect(page.locator(".k-dialog")).toContainText("Moved 1 record", { timeout: 30_000 });
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();

  // THE POINT: reload. The app now opens on JazzStore, and the record must be there — served by
  // cojson out of OPFS, after a genuine page teardown.
  await page.goto("/?user=sync-target");
  await expect(page.locator("h1").first()).toHaveText("Sync Target", { timeout: 30_000 });
  await expect(page.locator(".k-list-row", { hasText: "Before sync" })).toBeVisible({ timeout: 30_000 });
});

test.fixme("a record added AFTER sync is on survives an immediate reload", async ({ page }) => {

  await page.goto("/?user=sync-target");
  await expect(page.locator("h1").first()).toHaveText("Sync Target", { timeout: 30_000 });
  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await page.getByRole("button", { name: "Turn on sync for Sync Target" }).click();
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".k-dialog")).toContainText("Moved", { timeout: 30_000 });
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();

  await page.goto("/?user=sync-target");
  await page.getByRole("button", { name: /New Note|Add Note/i }).first().click();
  await page.getByLabel(/title/i).fill("Written to the CRDT store");
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(page.locator(".k-list-row", { hasText: "Written to the CRDT store" })).toBeVisible();

  // No settling delay on purpose. cojson flushes asynchronously, so this reload races the flush —
  // exactly the "add a record, refresh instantly, gone" bug. It passes only because writes now
  // await durability before returning.
  await page.goto("/?user=sync-target");
  await expect(page.locator(".k-list-row", { hasText: "Written to the CRDT store" })).toBeVisible({
    timeout: 30_000,
  });
});
