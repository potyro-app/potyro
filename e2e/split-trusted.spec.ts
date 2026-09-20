import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// The Split example: what two people owe each other, agreed to the cent on both devices.
//
// This is the example that cannot be checked on one screen. Money in whole minor units, the split
// helpers' fixed remainder order and `member` fields pointing at the space's people only matter
// when there are two copies — and the failure they prevent (each device rounding its own way, so a
// €100 dinner comes out as €100.01 between three people) is invisible until there are.

async function device(context: BrowserContext): Promise<Page> {
  await context.addInitScript(() => localStorage.setItem("karta:sync:relay", "ws://localhost:4201"));
  return context.newPage();
}

/** Add an expense the quick way: description, amount, and whatever the form already defaults to. */
const addExpense = async (page: Page, description: string, amount: string, opts?: { clearBetween?: boolean }): Promise<void> => {
  await page.getByRole("button", { name: /Add expense/ }).first().click();
  await page.getByLabel("Description").fill(description);
  await page.getByLabel(/^Amount/).fill(amount);
  if (opts?.clearBetween) {
    // What an expense written before the form filled this in looks like: a payer, an amount, and
    // nobody named.
    // Re-queried each time: toggling one re-renders the row, which detaches every handle taken
    // before the click.
    const on = page.locator(".k-member-input .k-person-chip[aria-pressed='true']");
    for (let left = await on.count(); left > 0; left -= 1) await on.first().click();
    await expect(on).toHaveCount(0);
  }
  await page.getByRole("button", { name: /^(Create|Save)/ }).first().click();
  await page.getByRole("button", { name: "Expenses" }).first().click();
  await expect(page.locator(".k-list-row", { hasText: description })).toBeVisible({ timeout: 60_000 });
};

/** Pick a person in a share row by who they are, whatever the app happens to call you. */
const pickPerson = async (row: Locator, who: RegExp): Promise<void> => {
  const select = row.locator("select");
  const labels = await select.locator("option").allTextContents();
  const match = labels.find((l) => who.test(l.trim()));
  expect(match, `no one matching ${who} among ${labels.join(" / ")}`).toBeTruthy();
  await select.selectOption({ label: match! });
};

/**
 * The halves of the two expenses the app comes with that belong to whoever joins (#222).
 *
 * They used to name the owner alone and so contributed nothing to a second person's balance —
 * which is what made them read as broken ("your share €0.00") the moment the app was shared. Now
 * they split like any other expense, so every balance in this file carries them: (42.85 + 39.00)/2.
 */
const SEEDED_HALF = 40.92;

const openSplit = async (page: Page): Promise<void> => {
  await page.goto("/?user=split");
  // The app asks which group before it shows anything; the seed leaves exactly one.
  const flat = page.getByRole("button", { name: /^Flat/ });
  await expect(flat.first()).toBeVisible({ timeout: 30_000 });
  await flat.first().click();
};

test("a bill split by shares lands on the same cents for both people", async ({ browser }) => {
  test.slow();

  // ---- Ana shares the app ----
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ana = await device(ctxA);
  await openSplit(ana);
  await expect(ana.locator(".k-list-row", { hasText: "Groceries" })).toBeVisible({ timeout: 30_000 });

  await ana.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(ana, "Split", "share");
  await ana.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(ana, "Ana");
  const field = ana.locator(".k-dialog input");
  await expect(field).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await field.inputValue();
  await ana.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(ana.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await ana.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(ana.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });

  // ---- Bo joins ----
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const bo = await device(ctxB);
  await bo.goto(link);
  await bo.locator(".k-dialog").getByRole("button", { name: /Join and trust/ }).click();
  await answerNamePrompt(bo, "Bo");
  const boFlat = bo.getByRole("button", { name: /^Flat/ });
  await expect(boFlat.first()).toBeVisible({ timeout: 60_000 });
  await boFlat.first().click();
  await expect(bo.locator(".k-list-row", { hasText: "Groceries" })).toBeVisible({ timeout: 60_000 });

  // ---- Ana pays €100 for dinner, split two shares to one ----
  await ana.getByRole("button", { name: /Add expense/ }).first().click();
  await ana.getByLabel("Description").fill("Dinner");
  await ana.getByLabel(/^Amount/).fill("100");
  await ana.getByRole("radio", { name: "shares" }).click();
  await ana.getByRole("button", { name: /Add by share/ }).click();
  await ana.getByRole("button", { name: /Add by share/ }).click();
  const rows = ana.locator(".k-row-card");
  await expect(rows).toHaveCount(2);
  // Ana takes two shares of the bill, Bo one: €66.67 and €33.33, adding up to exactly €100.
  await pickPerson(rows.nth(0), /^(Me|You|Ana)/);
  await rows.nth(0).locator("input.k-number-input").fill("2");
  await pickPerson(rows.nth(1), /^Bo/);
  await rows.nth(1).locator("input.k-number-input").fill("1");
  await ana.getByRole("button", { name: /^(Create|Save)/ }).first().click();

  // ---- What each of them is told ----
  // Back on the group, wherever creating happened to leave her.
  await ana.getByRole("button", { name: "Expenses" }).first().click();
  // €33.33 of this bill, plus Bo's halves of the two the app came with.
  const owed = `€${(33.33 + SEEDED_HALF).toFixed(2)}`;
  const balances = ana.locator(".k-aggregate");
  await expect(balances).toContainText(owed, { timeout: 60_000 });
  await expect(balances).toContainText("you are owed");

  // Bo's copy agrees, without a reload, and says it from his side.
  const boBalances = bo.locator(".k-aggregate");
  await expect(boBalances).toContainText(owed, { timeout: 60_000 });
  await expect(boBalances).toContainText("you owe");
  // And the way out of it, in one payment.
  await expect(boBalances).toContainText(/You → Ana/);

  // The expense itself shows the arithmetic, the same on both sides.
  await bo.locator(".k-list-row", { hasText: "Dinner" }).click();
  await expect(bo.locator("article.k-detail")).toContainText("Ana €66.67");
  await expect(bo.locator("article.k-detail")).toContainText("You €33.33");

  if (process.env.KARTA_SHOTS) {
    await ana.screenshot({ path: `${process.env.KARTA_SHOTS}/split-balances.png` });
    await bo.screenshot({ path: `${process.env.KARTA_SHOTS}/split-expense.png` });
  }

  await ctxA.close();
  await ctxB.close();
});

test("two people who each paid for something owe the difference, not the whole", async ({ browser }) => {
  test.slow();

  // Ana pays €65, Bo pays €35, both split equally between the two of them. The answer is €15 one
  // way — not "Ana is owed 65 and Bo is owed 35", which is what an expense that defaults to nobody
  // produces: the payer credited in full and no one charged.
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ana = await device(ctxA);
  await openSplit(ana);
  await ana.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(ana, "Split", "share");
  await ana.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(ana, "Ana");
  const field = ana.locator(".k-dialog input");
  await expect(field).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await field.inputValue();
  await ana.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(ana.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await ana.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(ana.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });

  const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const bo = await device(ctxB);
  await bo.goto(link);
  await bo.locator(".k-dialog").getByRole("button", { name: /Join and trust/ }).click();
  await answerNamePrompt(bo, "Bo");
  const boFlat = bo.getByRole("button", { name: /^Flat/ });
  await expect(boFlat.first()).toBeVisible({ timeout: 60_000 });
  await boFlat.first().click();
  // Ana has to see Bo before an expense of hers can be split with him.
  await expect(ana.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });
  await expect(bo.locator(".k-list-row", { hasText: "Groceries" })).toBeVisible({ timeout: 60_000 });

  await addExpense(ana, "Taxi", "65");
  await addExpense(bo, "Drinks", "35");

  // €65 split two ways is €32.50 each; €35 is €17.50 each. Ana is out €15 on these two — plus Bo's
  // halves of the two the app came with, which are hers as well.
  const owed = `€${(15 + SEEDED_HALF).toFixed(2)}`;
  const balances = ana.locator(".k-aggregate");
  await expect(balances).toContainText(owed, { timeout: 60_000 });
  await expect(balances).toContainText("you are owed");
  await expect(balances).not.toContainText("€65.00");
  await expect(bo.locator(".k-aggregate")).toContainText(owed, { timeout: 60_000 });
  await expect(bo.locator(".k-aggregate")).toContainText("you owe");

  await ctxA.close();
  await ctxB.close();
});

test("an expense with nobody named is still split between the people in the group", async ({ browser }) => {
  test.slow();

  // Their two expenses, written before the form named anyone: €65 from one side, €35 from the
  // other, and nothing in "Between". Ignoring them is honest and useless — the money was spent —
  // so a blank list reads as everyone here, and the answer is the same €15.
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ana = await device(ctxA);
  await openSplit(ana);
  await ana.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(ana, "Split", "share");
  await ana.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(ana, "Ana");
  const field = ana.locator(".k-dialog input");
  await expect(field).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await field.inputValue();
  await ana.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(ana.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await ana.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(ana.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });

  const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const bo = await device(ctxB);
  await bo.goto(link);
  await bo.locator(".k-dialog").getByRole("button", { name: /Join and trust/ }).click();
  await answerNamePrompt(bo, "Bo");
  const boFlat = bo.getByRole("button", { name: /^Flat/ });
  await expect(boFlat.first()).toBeVisible({ timeout: 60_000 });
  await boFlat.first().click();
  await expect(bo.locator(".k-list-row", { hasText: "Groceries" })).toBeVisible({ timeout: 60_000 });
  await expect(ana.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });

  await addExpense(ana, "Taxi", "65", { clearBetween: true });
  await addExpense(bo, "Drinks", "35", { clearBetween: true });

  // Same €15 as above, and the same two seeded halves alongside it.
  const balances = ana.locator(".k-aggregate");
  await expect(balances).toContainText(`€${(15 + SEEDED_HALF).toFixed(2)}`, { timeout: 60_000 });
  await expect(balances).toContainText("you are owed");
  await expect(balances).not.toContainText("Nobody owes anybody");
  await expect(bo.locator(".k-aggregate")).toContainText("you owe", { timeout: 60_000 });

  await ctxA.close();
  await ctxB.close();
});
