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

const SOURCE = `import { defineApp } from "karta";
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
      localStorage.setItem("karta:sync:relay", "ws://localhost:4201");
      if (!s || localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem(
        "karta:user-apps",
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

  await a.getByRole("button", { name: /New Note|Add Note/i }).first().click();
  await a.getByLabel(/title/i).fill("Buy stamps");
  await a.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(a.locator(".k-detail-title")).toHaveText("Buy stamps", { timeout: 30_000 });

  // Home, and a reload: A is NOT sitting in the app when B asks. A backup that only happens while
  // you have the app open is a backup you have to remember to make.
  await a.goto("/");
  await expect(a.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });

  // Its words.
  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await a.getByRole("button", { name: "You and your devices" }).click();
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
