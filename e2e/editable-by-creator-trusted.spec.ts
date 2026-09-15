import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// Rows only their creator may change (`editableBy: "creator"`, KA-21 / #62).
//
// Ana adds an expense, Bo adds one. On his phone Bo can edit his own, but on Ana's the Edit button
// and the ⋯ menu are inactive, and a tap says who can change it — in full, inside the screen, not
// running off its edge. The store-level guarantee (another copy's edit simply does not take) is
// `jazz-store.test.ts`; this is what the person sees.

const SOURCE = `import { defineApp } from "karta";
export default defineApp({
  id: "trip", name: "Trip Costs", version: "1.0.0", schemaVersion: 1,
  entities: { expense: { label: "Expense", icon: "💶", displayField: "description", editableBy: "creator", fields: {
    description: { type: "text", required: true },
    amount: { type: "number" },
  } } },
  pages: [
    { id: "all", title: "Expenses", view: { type: "list", entity: "expense", display: { primary: "description" }, onOpen: { page: "expense", param: { expenseId: "id" } } } },
    { id: "expense", title: "Expense", hidden: true, view: { type: "detail", entity: "expense", param: "expenseId" } },
  ],
});
`;

async function device(context: BrowserContext, seed = false): Promise<Page> {
  await context.addInitScript(
    ([source, s]) => {
      localStorage.setItem("karta:sync:relay", "ws://localhost:4201");
      if (!s || localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem("karta:user-apps", JSON.stringify([{ id: "trip", name: "Trip Costs", source, trusted: true, updatedAt: new Date().toISOString() }]));
    },
    [SOURCE, seed] as const,
  );
  return context.newPage();
}

const add = async (page: Page, description: string): Promise<void> => {
  await page.getByRole("button", { name: /New Expense|Add Expense/i }).first().click();
  await page.getByLabel(/description/i).fill(description);
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  // Saving opens the record it just made.
  await expect(page.locator(".k-detail-title")).toHaveText(description, { timeout: 30_000 });
};

test("on someone else's row, Edit and Delete are inactive and say who can change it", async ({ browser }) => {
  test.slow();

  // ---- Ana shares ----
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const a = await device(ctxA, true);
  await a.goto("/?user=trip");
  await expect(a.locator("h1").first()).toHaveText("Trip Costs", { timeout: 30_000 });
  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "Trip Costs", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(a, "Ana");
  const field = a.locator(".k-dialog input");
  await expect(field).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await field.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await a.goto("/?user=trip");
  await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 30_000 });
  await add(a, "Dinner");

  // ---- Bo joins on a phone, adds his own ----
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(b, "Bo");
  await expect(b.locator("h1").first()).toHaveText("Trip Costs", { timeout: 60_000 });
  await expect(b.locator(".k-list-row", { hasText: "Dinner" })).toBeVisible({ timeout: 60_000 });
  await add(b, "Taxi");

  // ---- His own: Edit works (the phone opened it on save) ----
  await expect(b.locator(".k-detail-title")).toHaveText("Taxi");
  const bEdit = b.locator(".k-detail-actions").getByRole("button", { name: "Edit" });
  await expect(bEdit).not.toHaveAttribute("aria-disabled", "true");
  await b.getByRole("button", { name: "Back" }).first().click();

  // ---- Ana's: inactive, and a tap explains ----
  await b.locator(".k-list-row", { hasText: "Dinner" }).click();
  const edit = b.locator(".k-detail-actions").getByRole("button", { name: "Edit" });
  const more = b.locator(".k-detail-actions").getByRole("button", { name: "More actions" });
  await expect(edit).toHaveAttribute("aria-disabled", "true");
  await expect(edit).toHaveCSS("opacity", "0.45");
  await expect(more).toHaveAttribute("aria-disabled", "true");

  // `force`: Playwright will not click an aria-disabled control; a finger will.
  await edit.click({ force: true });
  const toast = b.locator(".k-toast", { hasText: "who added this, can change it" });
  await expect(toast).toHaveText("Only Ana, who added this, can change it.");
  await expect(b.locator(".k-form-fields")).toHaveCount(0);
  // The whole sentence is on screen: nothing past either edge.
  const box = await toast.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  if (process.env.KARTA_SHOTS) await b.screenshot({ path: `${process.env.KARTA_SHOTS}/creator-only-phone.png` });

  await more.click({ force: true });
  await expect(b.locator("[role=menu]")).toHaveCount(0);

  // ---- And Ana can change her own (saving it left her on its page) ----
  await expect(a.locator(".k-detail-title")).toHaveText("Dinner");
  await expect(a.locator(".k-detail-actions").getByRole("button", { name: "Edit" })).not.toHaveAttribute("aria-disabled", "true");

  await ctxA.close();
  await ctxB.close();
});
