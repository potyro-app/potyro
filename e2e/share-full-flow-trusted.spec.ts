import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// THE WHOLE SHARING FLOW, end to end, in two browser contexts.
//
// This exists because the sync specs each covered one hop and the flow as a whole was never walked.
// Two regressions shipped straight through them:
//
//   1. `joinSpace` writes the group id BEFORE opening the store, and the legacy-database rule reads
//      "group id present, no marker" as "this space predates the rename" — so every JOIN opened a
//      wrongly-named database. The two-peer spec passed regardless, because a guest has no earlier
//      data for the wrong file to lose.
//   2. A guest who tries to share got a raw cojson failure —
//      `Failed to set role writerInvite to sealer_z… (role of current account is writer)` — because
//      minting an invite needs admin and a guest is a writer.
//
// Both were reported by the owner, not by the suite. Hence this file: it walks the flow to the end
// and keeps walking after the first success, which is where both defects lived.

const STARTER = `import { defineApp } from "karta";

export default defineApp({
  id: "shareflow",
  name: "Share Flow",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    spot: {
      label: "Spot",
      icon: "📍",
      displayField: "name",
      fields: { name: { type: "text", required: true } },
    },
  },
  pages: [
    { id: "all", title: "Spots", view: { type: "list", entity: "spot", display: { primary: "name" } } },
  ],
});
`;

async function device(context: BrowserContext, opts?: { app?: boolean }): Promise<Page> {
  await context.addInitScript(
    ([source, seedApp]) => {
      localStorage.setItem("karta:sync:relay", "ws://localhost:4201");
      if (!seedApp || localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([
          { id: "shareflow", name: "Share Flow", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER, opts?.app ?? false] as const,
  );
  return context.newPage();
}

const add = async (page: Page, name: string): Promise<void> => {
  await page.getByRole("button", { name: /New Spot|Add Spot/i }).first().click();
  await page.getByLabel(/name/i).fill(name);
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(page.locator(".k-list-row", { hasText: name })).toBeVisible();
};

/** Open the launcher and press Share on the app, returning the dialog. */
async function pressShare(page: Page): Promise<void> {
  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(page, "Share Flow", "share");
}

test("share → join → the guest writes → the owner shares AGAIN", async ({ browser }) => {
  test.slow();

  // ---- owner ----
  const ctxA = await browser.newContext();
  const a = await device(ctxA, { app: true });
  await a.goto("/?user=shareflow");
  await expect(a.locator("h1").first()).toHaveText("Share Flow", { timeout: 30_000 });
  await add(a, "Miradouro");

  await pressShare(a);
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // turns sync on
  await answerNamePrompt(a);

  const linkField = a.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();

  // Back to the app itself. Sharing leaves the launcher open over the list, and a peer's write can
  // hardly be seen through it.
  await a.goto("/?user=shareflow");
  await expect(a.locator(".k-sync-status")).toBeVisible({ timeout: 30_000 });

  // ---- guest joins ----
  const ctxB = await browser.newContext();
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: /Join and trust/ }).click(); // trust prompt
  await answerNamePrompt(b);
  await expect(b.locator("h1").first()).toHaveText("Share Flow", { timeout: 60_000 });
  await expect(b.locator(".k-list-row", { hasText: "Miradouro" })).toBeVisible({ timeout: 60_000 });

  // The guest's store must be the one the invite pointed at — not a per-app file the join path
  // wandered into. Regression 1 put it in `user:shareflow-jazz`.
  expect(await b.evaluate(() => localStorage.getItem("karta:jazz:db:user:shareflow"))).toBe("karta-jazz");

  // ---- the guest writes, and it reaches the owner ----
  await add(b, "Tasca");
  await expect(a.locator(".k-list-row", { hasText: "Tasca" })).toBeVisible({ timeout: 60_000 });

  // ---- THE OWNER SHARES AGAIN. Minting a second invite must keep working. ----
  await pressShare(a);
  const second = a.locator(".k-dialog input");
  await expect(second).toHaveValue(/#join=/, { timeout: 60_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();

  // ---- and a GUEST pressing share is told why, not shown a crypto error ----
  // Minting an invite needs admin; a guest is a writer. That is correct behaviour, but it used to
  // surface as `Failed to set role writerInvite to sealer_z… (role of current account is writer)`.
  await pressShare(b);
  const guestDialog = b.locator(".k-dialog");
  await expect(guestDialog).toBeVisible({ timeout: 30_000 });
  const text = (await guestDialog.innerText()).toLowerCase();
  expect(text).not.toContain("sealer_");
  expect(text).not.toContain("writerinvite");
  expect(text).toMatch(/only|owner|created|cannot share|permission/);

  await ctxA.close();
  await ctxB.close();
});
