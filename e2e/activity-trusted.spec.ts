import { test, expect, type BrowserContext, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";
import { E2E_RELAY } from "./ports";

// "What changed while I was away", end to end, in two browsers (KA-36).
//
// This is the assertion the whole feature is for, and it CANNOT be made on one device: attributing
// every edit to whoever is reading would look perfectly correct in a single browser and be wrong the
// moment two people share an app. Bruno edits; Ana must read Bruno's name.
//
// It also pins that nothing is stored to make this work — Bruno's edit is an ordinary field change,
// with no activity API called and no event emitted. The feed is a fold over the CRDT log, so it is
// unforgeable (the author comes from the signing session) and retroactive.

const STARTER = `import { defineApp } from "potyro";

export default defineApp({
  id: "shoplist",
  name: "Shoplist",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      icon: "🛒",
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        qty: { type: "number", label: "Quantity" },
      },
    },
  },
  pages: [
    { id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "name", secondary: "qty" } } },
  ],
});
`;

async function device(context: BrowserContext, opts?: { app?: boolean }): Promise<Page> {
  await context.addInitScript((relay) => localStorage.setItem("potyro:sync:relay", relay), E2E_RELAY);
  await context.addInitScript(
    ([source, seedApp]) => {
      if (!seedApp || localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([
          { id: "shoplist", name: "Shoplist", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER, opts?.app ?? false] as const,
  );
  return context.newPage();
}

/** "Changes" lives with the shell's other tools now (#chat preview): the sidebar on a wide screen,
 *  the ⋯ menu on a phone. Both render a button with that name. */
const openChanges = async (page: Page): Promise<void> => {
  const inline = page.getByRole("button", { name: /^Changes/ });
  if (await inline.count()) {
    await inline.first().click();
    return;
  }
  await page.getByRole("button", { name: /^More/ }).first().click();
  await page.getByRole("menuitem", { name: /^Changes/ }).click();
};

test("a peer's change is reported by name, as one event, and marks the row", async ({ browser }) => {
  test.slow();

  // ---- Ana owns the app and shares it ----
  const ctxA = await browser.newContext();
  const ana = await device(ctxA, { app: true });
  await ana.goto("/?user=shoplist");
  await expect(ana.locator("h1").first()).toHaveText("Shoplist", { timeout: 30_000 });

  await ana.getByRole("button", { name: /Add: Item|Add Item/i }).first().click();
  await ana.getByLabel(/name/i).fill("Milk");
  await ana.getByLabel(/quantity/i).fill("2");
  await ana.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(ana.locator(".k-list-row", { hasText: "Milk" })).toBeVisible();

  await ana.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(ana, "Shoplist", "share");
  await ana.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(ana, "Ana");
  const linkField = ana.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await ana.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(ana.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await ana.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();

  await ana.goto("/?user=shoplist");
  // Ana has now seen everything up to here — including her own edits, which must not be reported
  // back to her as news.
  await expect(ana.getByRole("button", { name: /^Changes/ })).toBeVisible({ timeout: 30_000 });
  await openChanges(ana);
  await ana.locator(".k-activity").getByRole("button", { name: "Close" }).click();

  // ---- Bruno joins and changes the quantity. An ordinary edit; no activity API involved. ----
  const ctxB = await browser.newContext();
  const bruno = await device(ctxB);
  await bruno.goto(link);
  await bruno.locator(".k-dialog").getByRole("button", { name: /Join, run it as yours/ }).click();
  // Joining asks for a name, which is how Ana's copy gets something to render instead of an account
  // id. This used to be a detour through the identity panel plus a reload; the prompt is now on the
  // path, so the detour was removed rather than left as ceremony.
  await answerNamePrompt(bruno, "Bruno");
  await expect(bruno.locator(".k-list-row", { hasText: "Milk" })).toBeVisible({ timeout: 60_000 });

  // The row is the way in (#111): with no detail page, tapping it opens the editor.
  const row = bruno.locator(".k-list-row", { hasText: "Milk" }).first();
  await row.locator(".k-list-text").click({ timeout: 30_000 });
  const qty = bruno.getByLabel(/quantity/i);
  await expect(qty).toBeVisible({ timeout: 30_000 });
  await qty.fill("5");
  // "Save changes" on an edit, "Create" on a new record — an anchored /^Save$/ matches neither.
  await bruno.getByRole("button", { name: "Save changes" }).first().click();

  // ---- THE POINT: Ana is told what happened, by whom, where it happened ----
  // The tool says how many, beside its own name, and arrives there without a reload.
  const count = ana.getByRole("button", { name: /^Changes/ }).locator(".k-tool-hint");
  await expect(count).toHaveText(/1 new/, { timeout: 60_000 });
  // The row Bruno touched carries the mark, in the list Ana was looking at anyway.
  const anaRow = ana.locator(".k-list-row", { hasText: "Milk" }).first();
  await expect(anaRow).toHaveAttribute("data-news", "true", { timeout: 60_000 });
  // And the mark is DRAWN, not just declared: the row's ::after is a dot with a size and a colour.
  const dot = await anaRow.evaluate((el) => {
    const cs = getComputedStyle(el, "::after");
    return { width: cs.width, radius: cs.borderRadius, background: cs.backgroundColor };
  });
  expect(dot.width).toBe("8px");
  expect(dot.radius).toBe("50%");
  expect(dot.background).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

  await openChanges(ana);
  const panel = ana.locator(".k-activity");
  await expect(panel).toBeVisible();

  const text = await panel.innerText();
  // Attribution: the OTHER person, not "You". This is what one device cannot test.
  expect(text).toContain("Bruno");
  expect(text).not.toContain("You changed");
  // One event about the RECORD — never a line per field, never a value ("from 2 to 5").
  expect(text).toMatch(/Bruno changed Milk/);
  expect(text).not.toMatch(/Quantity|from\s+2/);
  expect(await panel.locator(".k-activity-item").count()).toBe(1);

  // Closing marks it seen; the badge and the row's mark clear, and stay cleared across a reload.
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(count).toHaveCount(0);
  await expect(anaRow).not.toHaveAttribute("data-news", "true");
  await ana.goto("/?user=shoplist");
  await expect(ana.getByRole("button", { name: /^Changes/ })).toBeVisible({ timeout: 30_000 });
  await expect(ana.getByRole("button", { name: /^Changes/ }).locator(".k-tool-hint")).toHaveCount(0);
  await expect(ana.locator(".k-list-row", { hasText: "Milk" }).first()).not.toHaveAttribute("data-news", "true");

  await ctxA.close();
  await ctxB.close();
});

test("a local-only app offers no activity at all", async ({ browser }) => {
  // Only a CRDT store keeps history. An empty panel here would claim "nothing happened" when the
  // truth is "this app does not record that", so the control is absent rather than empty.
  const ctx = await browser.newContext();
  const page = await device(ctx, { app: true });
  await page.goto("/?user=shoplist");
  await expect(page.locator("h1").first()).toHaveText("Shoplist", { timeout: 30_000 });
  await expect(page.locator(".k-list-row, .k-empty").first()).toBeVisible({ timeout: 30_000 });

  await expect(page.getByRole("button", { name: /^Changes/ })).toHaveCount(0);
  await ctx.close();
});
