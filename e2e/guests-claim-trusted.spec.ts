import { test, expect, type BrowserContext, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// Guests (docs/04 §Guests): Ana sets a trip up before anyone has joined — "Tom" paid for dinner — then
// shares it. Bo joins, says he is Tom, and the dinner is his on both devices, with nothing rewritten.

const RELAY = process.env.POTYRO_RELAY ?? "ws://localhost:4201";
const shots = process.env.POTYRO_SHOTS;

const TRIP = `import { defineApp } from "potyro";
export default defineApp({
  id: "trip", name: "Trip", version: "1.0.0", schemaVersion: 1,
  entities: {
    expense: {
      label: "Expense", icon: "🧾", displayField: "what",
      fields: { what: { type: "text", required: true }, paidBy: { type: "member", label: "Paid by" } },
    },
  },
  pages: [{
    id: "all", title: "Expenses",
    view: { type: "list", entity: "expense", display: { primary: (e) => e.what + " — " + (e.paidBy ? e.paidBy.name : "nobody") } },
    actions: [
      { label: "Dinner paid by Tom", run: async (ctx) => {
        const tom = ctx.people.find((p) => p.guest && p.name === "Tom");
        if (!tom) return ctx.ui.toast("No Tom");
        await ctx.create("expense", { what: "Dinner", paidBy: tom.id });
      } },
      { label: "Who is here", run: (ctx) => ctx.ui.toast(ctx.people.map((p) => p.name + (p.guest ? "*" : "")).join(", ")) },
    ],
  }],
});
`;

async function device(context: BrowserContext, seed = false): Promise<Page> {
  await context.addInitScript(
    ([source, s, relay]) => {
      localStorage.setItem("potyro:sync:relay", relay);
      if (!s || localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "trip", name: "Trip", source, trusted: true, updatedAt: new Date().toISOString() }]));
    },
    [TRIP, seed, RELAY] as const,
  );
  return context.newPage();
}

const openPeople = async (page: Page) => {
  await page.locator(".k-tools").getByRole("button", { name: "People" }).click();
  const panel = page.getByRole("dialog", { name: "People" });
  await expect(panel.locator(".k-people-row").first()).toBeVisible({ timeout: 30_000 });
  return panel;
};

test.use({ viewport: { width: 1280, height: 800 } });

test("a guest named before anyone joined is claimed by whoever joins, on both devices", async ({ browser }) => {
  test.slow();

  // ---- Ana, alone: the trip and its people before anyone is in it ----
  const ctxA = await browser.newContext();
  const a = await device(ctxA, true);
  await a.goto("/?user=trip");
  await expect(a.locator("h1").first()).toHaveText("Trip", { timeout: 30_000 });
  const solo = await openPeople(a);
  await expect(solo).toContainText("only on this device");
  await solo.getByRole("button", { name: /Add someone who hasn’t joined/ }).click();
  const ask = a.locator(".k-dialog", { hasText: "Their name" });
  await ask.locator("input").fill("Tom");
  await ask.getByRole("button", { name: "OK" }).click();
  await expect(solo.locator(".k-people-row[data-guest]", { hasText: "Tom" })).toContainText("Added by you");
  if (shots) await a.screenshot({ path: `${shots}/guests-people-solo.png` });
  await solo.getByRole("button", { name: "Close" }).click();

  await a.getByRole("button", { name: "Dinner paid by Tom" }).click();
  await expect(a.locator(".k-list-row", { hasText: "Dinner — Tom" })).toBeVisible();

  // ---- Ana shares it; the guest goes with it ----
  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "Trip", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // turn sync on
  await answerNamePrompt(a, "Ana");
  const field = a.locator(".k-dialog input");
  await expect(field).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await field.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await a.goto("/?user=trip");
  await expect(a.locator(".k-sync-status")).toBeVisible({ timeout: 30_000 });
  await expect(a.locator(".k-list-row", { hasText: "Dinner — Tom" })).toBeVisible({ timeout: 30_000 });
  // Ana added Tom herself: she is not asked whether she is him.
  await expect(a.getByRole("dialog", { name: "Are you one of these people?" })).toHaveCount(0);

  // ---- Bo joins, and is asked who he is ----
  const ctxB = await browser.newContext();
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: /Join, run it as yours/ }).click();
  await answerNamePrompt(b, "Bo");
  await expect(b.locator("h1").first()).toHaveText("Trip", { timeout: 60_000 });
  const claim = b.getByRole("dialog", { name: "Are you one of these people?" });
  await expect(claim.getByRole("button", { name: /Tom/ })).toBeVisible({ timeout: 60_000 });
  await expect(b.locator(".k-list-row", { hasText: "Dinner — Tom" })).toBeVisible({ timeout: 60_000 });
  if (shots) {
    await b.setViewportSize({ width: 390, height: 844 });
    await b.screenshot({ path: `${shots}/guests-claim-prompt.png` });
    await b.setViewportSize({ width: 1280, height: 800 });
  }
  await claim.getByRole("button", { name: /Tom/ }).click();
  await expect(claim).toHaveCount(0);
  await expect(b.locator(".k-toast").last()).toHaveText("You’re Tom in “Trip” now");

  // The dinner is Bo's now — on his device and on Ana's — and Tom is nobody's to pick any more.
  await expect(b.locator(".k-list-row", { hasText: "Dinner — Bo" })).toBeVisible({ timeout: 30_000 });
  await expect(a.locator(".k-list-row", { hasText: "Dinner — Bo" })).toBeVisible({ timeout: 60_000 });
  await b.getByRole("button", { name: "Who is here" }).click();
  await expect(b.locator(".k-toast").last()).toHaveText(/^(Ana, Bo|Bo, Ana)$/);
  const panel = await openPeople(a);
  await expect(panel.locator(".k-people-row", { hasText: "Bo" })).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator(".k-people-row[data-guest]")).toHaveCount(0);
  if (shots) await a.screenshot({ path: `${shots}/guests-claimed-ana.png` });

  // And Bo is not asked again on his next open.
  await b.reload();
  await expect(b.locator(".k-list-row", { hasText: "Dinner — Bo" })).toBeVisible({ timeout: 60_000 });
  await expect(b.getByRole("dialog", { name: "Are you one of these people?" })).toHaveCount(0);

  await Promise.all([ctxA.close(), ctxB.close()]);
});
