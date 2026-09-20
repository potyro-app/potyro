import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { answerNamePrompt } from "./name-prompt.js";
import { tileAction } from "./launcher-actions.js";

// Joining someone's app when you ALREADY have an app of that id — reported from a real session.
//
// Someone opened apps.vaz.io, used Split (seeded on every device under the id `split`), added their
// own expenses, and was then sent a share link for the owner's Split. The chat inside the app
// worked; the data did not. Two causes, both of them here:
//
//   1. The join overwrote their app record in place and flipped `sync` on its own, stranding the
//      records they had entered in the local database the app no longer opens.
//   2. Boot then ran the first-run seeder against the space they had just joined. A space that has
//      not replicated yet is indistinguishable from an empty one, so example rows were written into
//      the OWNER's data.
//
// The chat is a single unscoped thread, so it kept working throughout — which is exactly why this
// read as "sync is broken" rather than "you are looking at your own app".

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

async function device(context: BrowserContext): Promise<Page> {
  await context.addInitScript(
    (source) => {
      localStorage.setItem("karta:sync:relay", "ws://localhost:4201");
      if (localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([{ id: "shareflow", name: "Share Flow", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    STARTER,
  );
  return context.newPage();
}

const add = async (page: Page, name: string): Promise<void> => {
  await page.getByRole("button", { name: /New Spot|Add Spot/i }).first().click();
  await page.getByLabel(/name/i).fill(name);
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(page.locator(".k-list-row", { hasText: name })).toBeVisible();
};

test("joining a shared app you already have leaves your own data alone", async ({ browser }) => {
  test.slow();

  // ---- the owner shares an app with one record in it ----
  const ctxA = await browser.newContext();
  const a = await device(ctxA);
  await a.goto("/?user=shareflow");
  await expect(a.locator("h1").first()).toHaveText("Share Flow", { timeout: 30_000 });
  await add(a, "Miradouro");

  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "Share Flow", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(a);
  const linkField = a.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await a.goto("/?user=shareflow");

  // ---- the guest already has an app of that id, with their OWN record in it ----
  const ctxB = await browser.newContext();
  const b = await device(ctxB);
  await b.goto("/?user=shareflow");
  await expect(b.locator("h1").first()).toHaveText("Share Flow", { timeout: 30_000 });
  await add(b, "Mine");

  // ---- and then opens the link ----
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: /Join and trust/ }).click();
  await answerNamePrompt(b);

  // The shared app opens on the OWNER's data. Not the guest's own rows — those belong to the app
  // they already had, which this must not have taken over.
  await expect(b.locator(".k-list-row", { hasText: "Miradouro" })).toBeVisible({ timeout: 60_000 });
  await expect(b.locator(".k-list-row", { hasText: "Mine" })).toHaveCount(0);

  // Nothing of the guest's leaked into the owner's app either — no re-seed, no stray rows.
  await expect(a.locator(".k-list-row", { hasText: "Miradouro" })).toBeVisible({ timeout: 60_000 });
  await expect(a.locator(".k-list-row", { hasText: "Mine" })).toHaveCount(0);

  // Their own app still opens on their own record — the data that used to be stranded.
  await b.goto("/?user=shareflow");
  await expect(b.locator(".k-list-row", { hasText: "Mine" })).toBeVisible({ timeout: 30_000 });
  await expect(b.locator(".k-list-row", { hasText: "Miradouro" })).toHaveCount(0);

  // The guest now has both, and the one that arrived says where it came from.
  await b.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await expect(b.getByText("Share Flow (shared)", { exact: true })).toBeVisible({ timeout: 30_000 });

  await ctxA.close();
  await ctxB.close();
});
