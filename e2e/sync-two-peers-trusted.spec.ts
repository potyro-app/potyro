import { test, expect, type Page, type BrowserContext } from "@playwright/test";

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

async function seeded(context: BrowserContext): Promise<Page> {
  await context.addInitScript(
    ([source]) => {
      localStorage.setItem("karta:sync:relay", "ws://localhost:4201");
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([
          { id: "sync-pair", name: "Sync Pair", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER],
  );
  return context.newPage();
}

const add = async (page: Page, title: string): Promise<void> => {
  await page.getByRole("button", { name: /New Todo|Add Todo/i }).first().click();
  await page.getByLabel(/title/i).fill(title);
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(page.locator(".k-list-row", { hasText: title })).toBeVisible();
};

// STATUS: fixme — UNFINISHED, and the failure is in the test's own wiring, not the feature.
//
// Verified working up to this point: sync turns on, the data migrates, the invite link is minted and
// is small (<2000 chars), and the record survives a full reload served by the CRDT store.
//
// Where it stops: `expect(".k-sync-status").toContainText("Synced")`. The element never appears.
// `sync={saved.sync}` IS now passed to <App> and `SyncStatus` does render it, so the likely causes,
// in order: (a) the toggle set `sync` on a DIFFERENT app id than `?user=sync-pair` (the share flow
// enables sync itself, so `saved.sync` may still be stale on the reload right after); (b) the pill
// returns null while `state === "off"` and the effect has not yet run; (c) the relay probe fails in
// the Playwright network sandbox, leaving it "offline" rather than "Synced".
//
// Diagnose by dropping the pill assertion and letting the rest run — everything after it (the actual
// two-peer convergence) has never executed, so the feature itself is still UNVERIFIED end to end.
test.fixme("two devices share one dataset through the relay", async ({ browser }) => {
  test.slow();

  // ---- device A: owns the app, turns on sync, shares it ----
  const ctxA = await browser.newContext();
  const a = await seeded(ctxA);
  await a.goto("/?user=sync-pair");
  await expect(a.locator("h1").first()).toHaveText("Sync Pair", { timeout: 30_000 });
  await add(a, "milk");

  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await a.getByRole("button", { name: "Share Sync Pair" }).click();
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // turn sync on

  // The share dialog offers the link in an input.
  const linkField = a.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "OK" }).click(); // a prompt, not a confirm

  // The link must be small enough to survive a deep link on a device.
  expect(link.length).toBeLessThan(2000);

  await a.goto("/?user=sync-pair");
  await expect(a.locator(".k-list-row", { hasText: "milk" })).toBeVisible({ timeout: 30_000 });
  await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 30_000 });

  // ---- device B: a separate context, so separate storage and a separate identity ----
  const ctxB = await browser.newContext();
  const b = await seeded(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // trust prompt

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
