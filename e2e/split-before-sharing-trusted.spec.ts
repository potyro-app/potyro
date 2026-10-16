import { test, expect, type BrowserContext, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";
import { E2E_RELAY } from "./ports";

// What happens to an expense written BEFORE the other person was there.
//
// Reported: "I opened again split, added an expense A of 100. By default there is two items
// already, Groceries and Internet and they show as paid by myself. Shared the link and opened in a
// private tab, added expense B of 200. It shows that I am owed 100 in the private tab. Only the
// items A and B are counted, not the default ones."
//
// `between` is captured when an expense is written — right for "someone who joins next month was
// not at this dinner", wrong for every expense written in the minutes before you share the app.
// Named with only yourself in it, it is not a split at all: you cannot owe yourself. So a list of
// just you is left unset, and unset means "everyone in the group, whoever that is when the maths
// runs" — which is what `sharesOf` already did with an empty list.
//
// The visible symptom was two of four expenses sitting in the guest's list with a share of €0.00.

async function device(context: BrowserContext): Promise<Page> {
  await context.addInitScript((relay) => localStorage.setItem("potyro:sync:relay", relay), E2E_RELAY);
  return context.newPage();
}

const openSplit = async (page: Page): Promise<void> => {
  await page.goto("/?user=split");
  const flat = page.getByRole("button", { name: /^Flat/ });
  await expect(flat.first()).toBeVisible({ timeout: 30_000 });
  await flat.first().click();
};

const addExpense = async (page: Page, description: string, amount: string): Promise<void> => {
  await page.getByRole("button", { name: /Add expense/ }).first().click();
  await page.getByLabel("Description").fill(description);
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByRole("button", { name: /^(Create|Save)/ }).first().click();
  await page.getByRole("button", { name: "Expenses" }).first().click();
  await expect(page.locator(".k-list-row", { hasText: description })).toBeVisible({ timeout: 60_000 });
};

/** The share a row says is yours — "your share €50.00" under the description. */
const shareOf = (page: Page, description: string) => page.locator(".k-list-row", { hasText: description }).first();

test("expenses written before sharing still split with the person you share with", async ({ browser }) => {
  test.slow();

  // ---- Ana, alone, with the two the app came with and one of her own ----
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ana = await device(ctxA);
  await openSplit(ana);
  await expect(ana.locator(".k-list-row", { hasText: "Groceries" })).toBeVisible({ timeout: 30_000 });
  await addExpense(ana, "Expense A", "100");

  // ---- she shares it ----
  await ana.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(ana, "Split", "share");
  await ana.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(ana, "Ana");
  const field = ana.locator(".k-dialog input");
  await expect(field).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await field.inputValue();
  await ana.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  const after = ana.locator(".k-dialog");
  if (await after.isVisible().catch(() => false)) await after.getByRole("button", { name: "Cancel" }).click().catch(() => {});

  // ---- Bo joins and adds one of his own ----
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const bo = await device(ctxB);
  await bo.goto(link);
  await bo.locator(".k-dialog").getByRole("button", { name: /Join, run it as yours/ }).click();
  await answerNamePrompt(bo, "Bo");
  const boFlat = bo.getByRole("button", { name: /^Flat/ });
  await expect(boFlat.first()).toBeVisible({ timeout: 60_000 });
  await boFlat.first().click();
  await addExpense(bo, "Expense B", "200");

  // Every expense in the app is between the two of them now — including the two it came with and
  // the one Ana wrote before Bo existed. A share of €0.00 on any of them is the defect.
  await expect(shareOf(bo, "Expense B")).toContainText("your share €100.00", { timeout: 60_000 });
  await expect(shareOf(bo, "Expense A")).toContainText("your share €50.00", { timeout: 60_000 });
  await expect(shareOf(bo, "Groceries")).toContainText("your share €21.42", { timeout: 60_000 });
  await expect(shareOf(bo, "Internet")).toContainText("your share €19.50", { timeout: 60_000 });
  await expect(bo.locator(".k-list")).not.toContainText("your share €0.00");

  await ctxA.close();
  await ctxB.close();
});
