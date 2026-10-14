import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// Typing the recovery words gets you your APPS, not just your name (KA-16 follow-up).
//
// Linking already made a device you: same account, still a member of every space you are in. It
// arrived empty all the same, because the list of apps and the ids of the spaces holding their data
// lived in the other browser's localStorage. So a device could be you and own nothing.
//
// What this drives is the whole claim, end to end and in two real browsers: A syncs an app and
// writes something into it, B signs in with A's words, B is offered the app, and after loading it B
// has A's data — never having seen a share link.

const SOURCE = `import { defineApp } from "potyro";
export default defineApp({
  id: "notes", name: "Notes", icon: "📝", version: "1.0.0", schemaVersion: 1,
  entities: { note: { label: "Note", icon: "📝", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" }, onOpen: { page: "one", param: { noteId: "id" } } } },
          { id: "one", title: "Note", hidden: true, view: { type: "detail", entity: "note", param: "noteId" } }],
});
`;

async function device(context: BrowserContext, seed = false): Promise<Page> {
  await context.addInitScript(
    ([source, s]) => {
      localStorage.setItem("potyro:sync:relay", "ws://localhost:4201");
      if (!s || localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "notes", name: "Notes", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [SOURCE, seed] as const,
  );
  return context.newPage();
}

test("a device signed in with the words is offered the apps on the account, with their data", async ({ browser }) => {
  test.slow();

  // ---- A: an app that syncs, with something in it ----
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await device(ctxA, true);
  await a.goto("/?user=notes");
  await expect(a.locator("h1").first()).toHaveText("Notes", { timeout: 30_000 });

  // Sharing is the shortest way to a synced app; nobody else joins, so this stays a space of one —
  // which is exactly the case that used to be unrecoverable on a new device.
  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "Notes", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(a, "Ana");
  await expect(a.locator(".k-dialog input")).toHaveValue(/#join=/, { timeout: 60_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });

  await a.getByRole("button", { name: /Add: Note|Add Note/i }).first().click();
  await a.getByLabel(/title/i).fill("Buy stamps");
  await a.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(a.locator(".k-detail-title")).toHaveText("Buy stamps", { timeout: 30_000 });

  // Home, and a reload: A is NOT sitting in the app when B asks. A backup that only happens while
  // you have the app open is a backup you have to remember to make.
  await a.goto("/");
  await expect(a.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });

  // Its words. The launcher is where they live, and on the home screen it may be showing already —
  // opening it again would be a click with nothing to click.
  const devices = a.getByRole("button", { name: "You and your devices" });
  if (!(await devices.isVisible())) await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await devices.click();
  await a.getByRole("button", { name: /Add a device/ }).click();
  const words = (await a.locator(".k-passphrase").innerText({ timeout: 30_000 })).trim();
  expect(words.split(/\s+/)).toHaveLength(24);

  // ---- B: a new device. No apps, no data, nothing shared with it. ----
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const b = await device(ctxB);
  await b.goto("/");
  await b.getByRole("button", { name: "You and your devices" }).click();
  await b.getByRole("button", { name: /This is my second device/ }).click();
  const field = b.locator(".k-dialog input");
  await expect(field).toBeVisible({ timeout: 30_000 });
  await field.fill(words);
  await b.locator(".k-dialog").getByRole("button", { name: "OK" }).click();

  // ---- THE CLAIM: it is offered A's app, and loading it brings A's data ----
  const offer = b.locator(".k-restore");
  await expect(offer).toBeVisible({ timeout: 60_000 });
  await expect(offer).toContainText("Notes");
  await offer.getByRole("button", { name: /^Load/ }).click();

  await expect(b.locator(".k-launch-tile", { hasText: "Notes" }).first()).toBeVisible({ timeout: 60_000 });
  await b.goto("/?user=notes");
  // The note A wrote, on a device that never saw a share link.
  await expect(b.locator(".k-list-row", { hasText: "Buy stamps" })).toBeVisible({ timeout: 60_000 });

  await ctxA.close();
  await ctxB.close();
});

test("an app the new device already seeded for itself is still offered, with the data from the account", async ({ browser }) => {
  test.slow();
  // The scenario people actually test this with, and the one that failed: Groceries is an example,
  // so EVERY device seeds a copy for itself. Offering only apps the new device was missing meant the
  // Groceries with the shopping list in it was silently skipped — "groceries is not with sync on and
  // with the same data as before". A factory example is not a reason to withhold someone's own app.

  // ---- A: the seeded Groceries, with something added, synced ----
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctxA.addInitScript(() => localStorage.setItem("potyro:sync:relay", "ws://localhost:4201"));
  const a = await ctxA.newPage();
  await a.goto("/?user=groceries");
  await expect(a.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });

  const unique = `Cardamom ${Date.now()}`;
  const add = a.getByRole("textbox", { name: "Add an item" });
  await add.click();
  await add.pressSequentially(unique, { delay: 5 });
  await a.keyboard.press("Enter");
  await expect(a.getByRole("checkbox", { name: unique })).toBeVisible({ timeout: 30_000 });

  // Sync it on, from the launcher, the way a person does.
  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "Groceries", "sync");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(a.locator(".k-dialog")).toContainText("Moved", { timeout: 60_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  // Name yourself on this device. The answer belongs to the ACCOUNT, not to this browser — the
  // other device should not have to be told again.
  await a.goto("/");
  await a.getByRole("button", { name: "You and your devices" }).click();
  await a.getByRole("button", { name: /^(Set a name|Rename)$/ }).click();
  const nameField = a.locator(".k-dialog input");
  await expect(nameField).toBeVisible({ timeout: 30_000 });
  await nameField.fill("Ana");
  await a.locator(".k-dialog").getByRole("button", { name: "OK" }).click();
  await expect(a.locator(".k-identity-name")).toHaveText("Ana", { timeout: 30_000 });
  await a.keyboard.press("Escape");
  // The backup offer this device gets the first time it syncs anything.
  const laterA = a.locator(".k-restore").getByRole("button", { name: /Not now/ });
  if (await laterA.count()) await laterA.click();

  // Its words.
  await a.goto("/");
  await expect(a.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });
  const devices = a.getByRole("button", { name: "You and your devices" });
  if (!(await devices.isVisible())) await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await devices.click();
  await a.getByRole("button", { name: /Add a device/ }).click();
  const words = (await a.locator(".k-passphrase").innerText({ timeout: 30_000 })).trim();
  expect(words.split(/\s+/)).toHaveLength(24);

  // ---- B: a second browser, which has seeded its OWN Groceries ----
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } });
  await ctxB.addInitScript(() => localStorage.setItem("potyro:sync:relay", "ws://localhost:4201"));
  const b = await ctxB.newPage();
  await b.goto("/?user=groceries");
  await expect(b.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  // Its own copy: the example's items, not A's.
  await expect(b.getByRole("checkbox", { name: unique })).toHaveCount(0);

  await b.goto("/");
  await b.getByRole("button", { name: "You and your devices" }).click();
  await b.getByRole("button", { name: /This is my second device/ }).click();
  const field = b.locator(".k-dialog input");
  await expect(field).toBeVisible({ timeout: 30_000 });
  await field.fill(words);
  await b.locator(".k-dialog").getByRole("button", { name: "OK" }).click();

  // ---- THE CLAIM: Groceries is offered, and loading it brings A's list ----
  const offer = b.locator(".k-restore");
  await expect(offer).toBeVisible({ timeout: 60_000 });
  await expect(offer).toContainText("Groceries");
  await offer.getByRole("button", { name: /^Load/ }).click();

  await b.goto("/?user=groceries");
  await expect(b.getByRole("checkbox", { name: unique })).toBeVisible({ timeout: 60_000 });
  // And it is syncing here, not a local copy that merely looks right.
  await expect(b.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });

  // And this device knows who it is: the name was set on A, and it is the account's, not that
  // browser's. It used to stay behind, so a linked phone called itself "Me" and the people shared
  // with saw the same person twice, under two names.
  await b.goto("/");
  await b.getByRole("button", { name: "You and your devices" }).click();
  await expect(b.locator(".k-identity-name")).toHaveText("Ana", { timeout: 30_000 });

  await ctxA.close();
  await ctxB.close();
});

test("an app that was never synced is backed up by one switch, and a linked device brings it back", async ({ browser }) => {
  test.slow();
  // "If my laptop dies I just lost all my apps and data!" — the case the recovery words did nothing
  // for. An app nobody turned sync on for has no space and nothing on the relay, so a new device got
  // a name and an empty launcher. One switch now puts every app there, including this one.

  // ---- A: a local-only app with something in it ----
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctxA.addInitScript(
    ([source]) => {
      localStorage.setItem("potyro:sync:relay", "ws://localhost:4201");
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "notes", name: "Notes", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [SOURCE] as const,
  );
  const a = await ctxA.newPage();
  await a.goto("/?user=notes");
  await expect(a.locator("h1").first()).toHaveText("Notes", { timeout: 30_000 });

  await a.getByRole("button", { name: /Add: Note|Add Note/i }).first().click();
  await a.getByLabel(/title/i).fill("Ship the thing");
  await a.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(a.locator(".k-detail-title")).toHaveText("Ship the thing", { timeout: 30_000 });

  // Never synced: no tile action, no share, nothing on the relay.
  await a.goto("/");
  await a.getByRole("button", { name: "You and your devices" }).click();
  const backup = a.locator(".k-backup");
  await expect(backup).toContainText(/lives? only on this device/);

  // ---- The switch ----
  await backup.getByRole("button", { name: "Back up my apps" }).click();
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(backup).toContainText(/Moved 1 app/, { timeout: 120_000 });
  await expect(backup).toContainText(/can bring them all back/);

  // Its words.
  await a.getByRole("button", { name: /Add a device/ }).click();
  const words = (await a.locator(".k-passphrase").innerText({ timeout: 30_000 })).trim();
  expect(words.split(/\s+/)).toHaveLength(24);

  // ---- B: a second browser that has never seen this app ----
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } });
  await ctxB.addInitScript(() => localStorage.setItem("potyro:sync:relay", "ws://localhost:4201"));
  const b = await ctxB.newPage();
  await b.goto("/");
  await b.getByRole("button", { name: "You and your devices" }).click();
  await b.getByRole("button", { name: /This is my second device/ }).click();
  const field = b.locator(".k-dialog input");
  await expect(field).toBeVisible({ timeout: 30_000 });
  await field.fill(words);
  await b.locator(".k-dialog").getByRole("button", { name: "OK" }).click();

  // ---- THE CLAIM: the app nobody ever synced is offered, with its note ----
  const offer = b.locator(".k-restore");
  await expect(offer).toBeVisible({ timeout: 60_000 });
  await expect(offer).toContainText("Notes");
  await offer.getByRole("button", { name: /^Load/ }).click();

  await b.goto("/?user=notes");
  await expect(b.locator(".k-list-row", { hasText: "Ship the thing" })).toBeVisible({ timeout: 60_000 });

  await ctxA.close();
  await ctxB.close();
});
