import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { answerNamePrompt } from "./name-prompt.js";

// Two people, one dataset, through a real relay (KA-08's actual acceptance criterion).
//
// Everything below this has unit coverage, and unit coverage has been wrong three times in this
// track: a synchronous read of a CoValue restored from storage, an asynchronous storage flush, and
// `subscribe` never firing for a peer's changes. All three passed a fully green Node suite and would
// have failed on a user's first refresh. Only a test that crosses real process boundaries — two
// browser contexts, a websocket, a page reload — can catch that class.
//
// Two CONTEXTS, not two pages: contexts have separate storage, so this is genuinely two devices
// rather than two views of the same one.

const STARTER = `import { defineApp } from "karta";

export default defineApp({
  id: "sync-pair",
  name: "Sync Pair",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    todo: {
      label: "Todo",
      icon: "✅",
      displayField: "title",
      fields: { title: { type: "text", required: true } },
    },
  },
  pages: [
    { id: "all", title: "Todos", view: { type: "list", entity: "todo", display: { primary: "title" } } },
  ],
});
`;

/**
 * A device. `app` seeds the registry with the starter app — device A owns it; device B must NOT have
 * it, because "the source arrived over sync" is half of what this test claims.
 *
 * The seed is written ONCE per context, not once per navigation. An init script runs on every page
 * load, so an unconditional `setItem` re-wrote the registry each time and silently reset `sync` to
 * off. The reload after sharing then opened the LOCAL store, and every later assertion was answered
 * by the copy `toggleAppSync` deliberately leaves behind rather than by the CRDT store — which is
 * exactly why this spec appeared to fail at the sync pill.
 */
async function device(context: BrowserContext, opts?: { app?: boolean }): Promise<Page> {
  await context.addInitScript(
    ([source, seedApp]) => {
      localStorage.setItem("karta:sync:relay", "ws://localhost:4201");
      if (!seedApp || localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([
          { id: "sync-pair", name: "Sync Pair", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER, opts?.app ?? false] as const,
  );
  return context.newPage();
}

const add = async (page: Page, title: string): Promise<void> => {
  await page.getByRole("button", { name: /New Todo|Add Todo/i }).first().click();
  await page.getByLabel(/title/i).fill(title);
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(page.locator(".k-list-row", { hasText: title })).toBeVisible();
};

// Two bugs stood between this and green, and neither was where the feature is:
//
//   - the seed re-ran on every navigation and reset `sync` to off, so the reload after sharing
//     opened the local store (see `device` above);
//   - the join screen mounted a SECOND `<Dialogs>` on the one host `mount` already provides, so the
//     trust prompt rendered twice, stacked. That one was a real product bug, visible to anyone who
//     ever opened an invite.
//
// The convergence assertions passed on the first run after both were fixed.
test("two devices share one dataset through the relay", async ({ browser }) => {
  test.slow();

  // ---- device A: owns the app, turns on sync, shares it ----
  const ctxA = await browser.newContext();
  const a = await device(ctxA, { app: true });
  await a.goto("/?user=sync-pair");
  await expect(a.locator("h1").first()).toHaveText("Sync Pair", { timeout: 30_000 });
  await add(a, "milk");

  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await a.getByRole("button", { name: "Share Sync Pair" }).click();
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // turn sync on
  // Sharing asks what to call you now. Declined here: this spec is about data reaching the other
  // device, not about names, and declining is a supported answer.
  await answerNamePrompt(a);

  // The share dialog offers the link in an input.
  const linkField = a.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "OK" }).click(); // a prompt, not a confirm

  // Sharing is the first time this device's data leaves it, so the recovery-words offer appears
  // once, right after the link (ADR D2a). Declined here — the words are tested on their own spec.
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();

  // The link must be small enough to survive a deep link on a device.
  expect(link.length).toBeLessThan(2000);

  await a.goto("/?user=sync-pair");
  await expect(a.locator(".k-list-row", { hasText: "milk" })).toBeVisible({ timeout: 30_000 });
  await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 30_000 });

  // ---- device B: a separate context, so separate storage and a separate identity ----
  const ctxB = await browser.newContext();
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // trust prompt
  await answerNamePrompt(b);

  // B never created this app: both the DATA and the app SOURCE arrived over sync.
  await expect(b.locator("h1").first()).toHaveText("Sync Pair", { timeout: 60_000 });
  await expect(b.locator(".k-list-row", { hasText: "milk" })).toBeVisible({ timeout: 60_000 });

  // ---- B writes, A sees it WITHOUT touching anything ----
  await add(b, "bread");
  await expect(a.locator(".k-list-row", { hasText: "bread" })).toBeVisible({ timeout: 60_000 });

  // ---- A writes, B sees it ----
  await add(a, "eggs");
  await expect(b.locator(".k-list-row", { hasText: "eggs" })).toBeVisible({ timeout: 60_000 });

  // Both ends agree on the whole set.
  await expect(a.locator(".k-list-row")).toHaveCount(3);
  await expect(b.locator(".k-list-row")).toHaveCount(3);

  await ctxA.close();
  await ctxB.close();
});
