import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// Taking access back (#58). A shared app's owner removes someone from the People panel, and that
// removal is real: the person's role is revoked and the space's key rotated, so nothing written after
// it reaches them and nothing they write reaches anyone; and the links shared before stop working, so
// they cannot simply rejoin. And an owner can invite someone to view only.

const STARTER = `import { defineApp } from "karta";
export default defineApp({
  id: "people", name: "People App", version: "1.0.0", schemaVersion: 1,
  entities: { spot: { label: "Spot", icon: "📍", displayField: "name", fields: { name: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Spots", view: { type: "list", entity: "spot", display: { primary: "name" } } }],
});
`;

async function device(context: BrowserContext, seed = false): Promise<Page> {
  await context.addInitScript(
    ([source, s]) => {
      localStorage.setItem("karta:sync:relay", "ws://localhost:4201");
      if (!s || localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem("karta:user-apps", JSON.stringify([{ id: "people", name: "People App", source, trusted: true, updatedAt: new Date().toISOString() }]));
    },
    [STARTER, seed] as const,
  );
  return context.newPage();
}

const add = async (page: Page, name: string): Promise<void> => {
  await page.getByRole("button", { name: /New Spot|Add Spot/i }).first().click();
  await page.getByLabel(/name/i).fill(name);
  await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(page.locator(".k-list-row", { hasText: name })).toBeVisible();
};

const openPeople = async (page: Page) => {
  await page.locator(".k-tools").getByRole("button", { name: "People" }).click();
  const panel = page.getByRole("dialog", { name: "People" });
  await expect(panel.locator(".k-people-row").first()).toBeVisible({ timeout: 30_000 });
  return panel;
};

async function join(page: Page, link: string, name: string): Promise<void> {
  await page.goto(link);
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // trust
  await answerNamePrompt(page, name);
  await expect(page.locator("h1").first()).toHaveText("People App", { timeout: 60_000 });
}

test.use({ viewport: { width: 1280, height: 800 } });

test("the owner removes someone, who then gets nothing new and cannot rejoin with the old link; a view-only invite", async ({ browser }) => {
  test.slow();

  // ---- Ana owns the app and shares it ----
  const ctxA = await browser.newContext();
  const a = await device(ctxA, true);
  await a.goto("/?user=people");
  await expect(a.locator("h1").first()).toHaveText("People App", { timeout: 30_000 });
  await add(a, "Miradouro");
  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "People App", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // turn sync on
  await answerNamePrompt(a, "Ana");
  const field = a.locator(".k-dialog input");
  await expect(field).toHaveValue(/#join=/, { timeout: 60_000 });
  const oldLink = await field.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await a.goto("/?user=people");
  await expect(a.locator(".k-sync-status")).toBeVisible({ timeout: 30_000 });

  // ---- Bo joins with that link ----
  const ctxB = await browser.newContext();
  const b = await device(ctxB);
  await join(b, oldLink, "Bo");
  await expect(b.locator(".k-list-row", { hasText: "Miradouro" })).toBeVisible({ timeout: 60_000 });

  // ---- both see the people; only the owner can remove ----
  const bPanel = await openPeople(b);
  await expect(bPanel.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(bPanel).toContainText("Only Ana");
  await bPanel.getByRole("button", { name: "Close" }).click();

  const aPanel = await openPeople(a);
  await expect(aPanel.locator(".k-people-row", { hasText: "Bo" })).toContainText("Can edit", { timeout: 60_000 });
  await expect(aPanel.locator(".k-people-row", { hasText: "Ana" })).toContainText("Owner");
  if (process.env.KARTA_SHOTS) await a.screenshot({ path: `${process.env.KARTA_SHOTS}/people-owner.png` });

  // ---- Ana removes Bo ----
  await aPanel.locator(".k-people-row", { hasText: "Bo" }).getByRole("button", { name: "Remove" }).click();
  const confirm = a.locator(".k-dialog");
  await expect(confirm).toContainText("Links you shared before stop working");
  if (process.env.KARTA_SHOTS) await a.screenshot({ path: `${process.env.KARTA_SHOTS}/people-confirm.png` });
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(aPanel.locator(".k-people-row", { hasText: "Bo" })).toHaveCount(0, { timeout: 30_000 });
  await aPanel.getByRole("button", { name: "Close" }).click();

  // ---- what Ana writes now never reaches Bo; what Bo writes never reaches Ana ----
  await add(a, "After removal");
  // Bo can no longer write at all, and is told so in words, not in the sync engine's.
  await b.getByRole("button", { name: /New Spot|Add Spot/i }).first().click();
  await b.getByLabel(/name/i).fill("Bo was here");
  await b.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
  await expect(b.locator(".k-form-error")).toContainText("You can't change this app", { timeout: 30_000 });
  await b.getByRole("button", { name: "Cancel" }).click();
  await b.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click().catch(() => {}); // discard changes, if asked
  // A positive control first, so the negatives below are not just "sync was slow": a new member
  // joining with a FRESH link does receive Ana's new spot.
  await openPeople(a).then((p) => p.getByRole("button", { name: /Invite someone/ }).click());
  await a.getByRole("group", { name: "Invite someone" }).getByRole("button", { name: "Can view" }).click();
  const fresh = a.locator(".k-dialog input");
  await expect(fresh).toHaveValue(/#join=/, { timeout: 60_000 });
  const viewLink = await fresh.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();

  const ctxC = await browser.newContext();
  const c = await device(ctxC);
  await join(c, viewLink, "Carla");
  await expect(c.locator(".k-list-row", { hasText: "After removal" })).toBeVisible({ timeout: 60_000 });
  const cPanel = await openPeople(c);
  await expect(cPanel.locator(".k-people-row", { hasText: "Carla" })).toContainText("Can view", { timeout: 60_000 });
  await cPanel.getByRole("button", { name: "Close" }).click();

  // By now Carla has what Ana wrote after the removal; Bo still must not, and Bo's write reached nobody.
  await expect(b.locator(".k-list-row", { hasText: "After removal" })).toHaveCount(0);
  await expect(a.locator(".k-list-row", { hasText: "Bo was here" })).toHaveCount(0);
  await expect(c.locator(".k-list-row", { hasText: "Bo was here" })).toHaveCount(0);

  // ---- the old link no longer lets anyone in ----
  const ctxD = await browser.newContext();
  const d = await device(ctxD);
  await d.goto(oldLink);
  await d.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(d, "Dee");
  await expect(d.locator("body")).toContainText(/Could not join/, { timeout: 60_000 });

  await Promise.all([ctxA.close(), ctxB.close(), ctxC.close(), ctxD.close()]);
});
