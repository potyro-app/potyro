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
// The original blocker here — `openJazzStore` demanding the OPFS SAH-pool VFS, which headless
// Chromium and Firefox do not provide — is gone: the store falls back to IndexedDB-backed SQLite.
//
// The seed is written ONCE per browser, not once per navigation. An init script runs on every page
// load, and an unconditional `setItem` re-wrote the registry each time, resetting `sync` to off. The
// reloads below then opened the LOCAL store — and since `toggleAppSync` deliberately never deletes
// the pre-migration copy, every assertion was answered by that copy. Both tests passed without the
// CRDT store being read even once, which is the entire thing they exist to check.

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

/** A SECOND app, for the two-synced-apps-on-one-device case below. */
const SECOND = STARTER.replace(/sync-target/g, "sync-second").replace("Sync Target", "Sync Second");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([source, second]) => {
      if (localStorage.getItem("karta:user-apps")) return;
      const now = new Date().toISOString();
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([
          { id: "sync-target", name: "Sync Target", source, trusted: true, updatedAt: now },
          { id: "sync-second", name: "Sync Second", source: second, trusted: true, updatedAt: now },
        ]),
      );
    },
    [STARTER, SECOND],
  );
});

test("sync can be turned on, and the app's data comes with it", async ({ page }) => {

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
  // Non-vacuity guard: the pill renders only when the app is flagged synced, which is the exact
  // condition under which `openStore` takes the CRDT branch (it has no fallback). Without it, a
  // record read back out of the pre-migration local copy would look identical to a passing test.
  await expect(page.locator(".k-sync-status")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".k-list-row", { hasText: "Before sync" })).toBeVisible({ timeout: 30_000 });
});

test("a record added AFTER sync is on survives an immediate reload", async ({ page }) => {

  await page.goto("/?user=sync-target");
  await expect(page.locator("h1").first()).toHaveText("Sync Target", { timeout: 30_000 });
  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await page.getByRole("button", { name: "Turn on sync for Sync Target" }).click();
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".k-dialog")).toContainText("Moved", { timeout: 30_000 });
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();

  await page.goto("/?user=sync-target");
  // Same guard: this note has to be WRITTEN to the CRDT store for the reload below to mean anything.
  await expect(page.locator(".k-sync-status")).toBeVisible({ timeout: 30_000 });
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

// The SECOND synced app on one device, with NO RELAY. This failed outright before cojson's database
// was made device-global: the account CoValue lives only in the database that created it, so app two
// read the saved secret against an empty store and cojson answered
// `Account unavailable from all peers`.
//
// The dead relay port is the whole point, and it is not a trick. With the dev relay reachable this
// test passes even with the bug restored, because a relay that has already seen the account will
// happily serve it back — which is why the failure never showed up in development. ADR D3 calls a
// solo synced app (durable CRDT, no transport) the default, and that configuration had no such
// rescue: it was simply broken on the second app.
test("a SECOND app can be synced on the same device, with no relay", async ({ page }) => {
  // Before any navigation, so it is in place for the first boot.
  await page.addInitScript(() => localStorage.setItem("karta:sync:relay", "ws://127.0.0.1:4299"));

  const enableSyncFor = async (name: string): Promise<void> => {
    await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
    await page.getByRole("button", { name: `Turn on sync for ${name}` }).click();
    await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.locator(".k-dialog")).toContainText("Moved", { timeout: 30_000 });
    await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  };

  await page.goto("/?user=sync-target");
  await expect(page.locator("h1").first()).toHaveText("Sync Target", { timeout: 30_000 });
  await enableSyncFor("Sync Target");

  await page.goto("/?user=sync-second");
  await expect(page.locator("h1").first()).toHaveText("Sync Second", { timeout: 30_000 });
  await enableSyncFor("Sync Second");

  // Both open on the CRDT store, and both are writable — an identity that loads but can no longer
  // sign would be the quiet version of this failure.
  await page.goto("/?user=sync-second");
  await expect(page.locator(".k-sync-status")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /New Note|Add Note/i }).first().click();
  await page.getByLabel(/title/i).fill("Second app writes");
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(page.locator(".k-list-row", { hasText: "Second app writes" })).toBeVisible();

  await page.goto("/?user=sync-target");
  await expect(page.locator(".k-sync-status")).toBeVisible({ timeout: 30_000 });
  // Separate spaces: app two's record must not appear in app one.
  await expect(page.locator(".k-list-row", { hasText: "Second app writes" })).toHaveCount(0);
});
