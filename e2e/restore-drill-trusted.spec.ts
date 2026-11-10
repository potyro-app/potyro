import { readFileSync, writeFileSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// The restore drill's two ends (docs/16 §6), run by hand around a real backup. Skipped everywhere
// else: it talks to a relay that is not the test's own.
//
//   write  a new account makes an app that syncs through POTYRO_DRILL_RELAY (the live relay), puts
//          one note in it, and leaves its recovery words and the note's text in POTYRO_DRILL_FILE.
//          Then the backup is made, and a scratch relay started on the copy.
//   read   a device that has never seen any of it signs in with those words through
//          POTYRO_DRILL_RELAY (now the scratch relay, and nothing else), is offered the app, and
//          finds the note. The scratch relay has only what the backup held, so this passes only if
//          the backup holds a person's apps and their records.
//
//   POTYRO_DRILL=write POTYRO_DRILL_RELAY=wss://<site>/sync POTYRO_DRILL_FILE=/tmp/drill.json pnpm e2e e2e/restore-drill-trusted.spec.ts
//   POTYRO_DRILL=read  POTYRO_DRILL_RELAY=ws://127.0.0.1:4299 POTYRO_DRILL_FILE=/tmp/drill.json pnpm e2e e2e/restore-drill-trusted.spec.ts
//
// The file holds the recovery words of a throwaway account: delete it when the drill is done.

const PHASE = process.env.POTYRO_DRILL;
const RELAY = process.env.POTYRO_DRILL_RELAY ?? "";
const FILE = process.env.POTYRO_DRILL_FILE ?? "";

const SOURCE = `import { defineApp } from "potyro";
export default defineApp({
  id: "drill-notes", name: "Drill Notes", icon: "📝", version: "1.0.0", schemaVersion: 1,
  entities: { note: { label: "Note", icon: "📝", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Drill Notes", view: { type: "list", entity: "note", display: { primary: "title" }, onOpen: { page: "one", param: { noteId: "id" } } } },
          { id: "one", title: "Note", hidden: true, view: { type: "detail", entity: "note", param: "noteId" } }],
});
`;

async function device(context: BrowserContext, seed: boolean): Promise<Page> {
  await context.addInitScript((relay) => localStorage.setItem("potyro:sync:relay", relay), RELAY);
  await context.addInitScript(
    ([source, s]) => {
      if (!s || localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "drill-notes", name: "Drill Notes", source, trusted: true, updatedAt: new Date().toISOString() }]));
    },
    [SOURCE, seed] as const,
  );
  return context.newPage();
}

test.describe("the restore drill", () => {
  test.skip(PHASE !== "write" && PHASE !== "read", "run by hand around a real backup (docs/16 §6)");
  test.skip(!RELAY || !FILE, "POTYRO_DRILL_RELAY and POTYRO_DRILL_FILE say where");

  test("write: an account, an app that syncs, one note", async ({ browser }) => {
    test.skip(PHASE !== "write");
    test.setTimeout(300_000);
    const note = `Drill ${new Date().toISOString()}`;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const a = await device(ctx, true);
    await a.goto("/?user=drill-notes");
    await expect(a.locator("h1").first()).toHaveText("Drill Notes", { timeout: 30_000 });

    await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
    await tileAction(a, "Drill Notes", "share");
    await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
    await answerNamePrompt(a, "Drill");
    await expect(a.locator(".k-dialog input")).toHaveValue(/#join=/, { timeout: 60_000 });
    await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
    await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
    await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });

    await a.getByRole("button", { name: /Add: Note|Add Note/i }).first().click();
    await a.getByLabel(/title/i).fill(note);
    await a.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
    await expect(a.locator(".k-detail-title")).toHaveText(note, { timeout: 30_000 });

    await a.goto("/");
    await expect(a.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });
    const devices = a.getByRole("button", { name: "You and your devices" });
    if (!(await devices.isVisible())) await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
    await devices.click();
    await a.getByRole("button", { name: /Add a device/ }).click();
    const words = (await a.locator(".k-passphrase").innerText({ timeout: 30_000 })).trim();
    expect(words.split(/\s+/)).toHaveLength(24);

    // Long enough for the relay to have taken everything: the backup is made after this returns.
    await a.goto("/?user=drill-notes");
    await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });
    await a.waitForTimeout(5_000);
    writeFileSync(FILE, JSON.stringify({ words, note, relay: RELAY, at: new Date().toISOString() }), { mode: 0o600 });
    await ctx.close();
  });

  test("read: a new device, the words, and the note is there", async ({ browser }) => {
    test.skip(PHASE !== "read");
    test.setTimeout(300_000);
    const { words, note } = JSON.parse(readFileSync(FILE, "utf8")) as { words: string; note: string };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    const b = await device(ctx, false);
    // Nothing but this device and the relay it was pointed at: a socket to anywhere else fails the drill.
    const elsewhere: string[] = [];
    b.on("websocket", (ws) => {
      if (!ws.url().startsWith(RELAY) && !/localhost:\d+\/(\?token|@vite|$)/.test(ws.url())) elsewhere.push(ws.url());
    });
    await b.goto("/");
    await b.getByRole("button", { name: "You and your devices" }).click();
    await b.getByRole("button", { name: /This is my second device/ }).click();
    const field = b.locator(".k-dialog input");
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.fill(words);
    await b.locator(".k-dialog").getByRole("button", { name: "OK" }).click();

    const offer = b.locator(".k-restore");
    await expect(offer).toBeVisible({ timeout: 60_000 });
    await expect(offer).toContainText("Drill Notes");
    await offer.getByRole("button", { name: /^Load/ }).click();
    await expect(b.locator(".k-launch-tile", { hasText: "Drill Notes" }).first()).toBeVisible({ timeout: 60_000 });
    await b.goto("/?user=drill-notes");
    await expect(b.locator(".k-list-row", { hasText: note })).toBeVisible({ timeout: 60_000 });
    expect(elsewhere).toEqual([]);
    await ctx.close();
  });
});
