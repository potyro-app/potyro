import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// APP CODE must see the space as it is now, not as it was at boot (KA-36 follow-up).
//
// `ctx.space` was captured once when the app opened, so a page opened before someone joined listed
// only the people who were there then — for the rest of the session. That is not just an activity-feed
// problem: any app reading `ctx.space.members` itself hits it — a split-among default, a person
// picker, "who is in this list".
//
// The app below renders its members through an `aggregate` view, so what is asserted is genuinely
// what APP CODE sees, not what the shell renders on its behalf.

const STARTER = `import { defineApp } from "karta";

export default defineApp({
  id: "roster",
  name: "Roster",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    note: {
      label: "Note",
      icon: "📝",
      displayField: "title",
      fields: { title: { type: "text", required: true } },
    },
  },
  pages: [
    { id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" } } },
    {
      id: "people",
      title: "People",
      view: {
        type: "aggregate",
        entity: "note",
        title: "In this list",
        emptyText: "Nobody yet.",
        // Reading ctx.space from inside the app — the whole point of this spec.
        rows: (_notes, ctx) =>
          (ctx.space?.members ?? [ctx.me]).map((m) => ({ id: m.id, label: m.name, group: "Members" })),
      },
    },
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
          { id: "roster", name: "Roster", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER, opts?.app ?? false] as const,
  );
  return context.newPage();
}

test("an app sees a new member without reloading", async ({ browser }) => {
  test.slow();

  const ctxA = await browser.newContext();
  const ana = await device(ctxA, { app: true });
  await ana.goto("/?user=roster");
  await expect(ana.locator("h1").first()).toHaveText("Roster", { timeout: 30_000 });

  // Share (which turns sync on), then come back to the app and open the People page.
  await ana.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await ana.getByRole("button", { name: "Share Roster" }).click();
  await ana.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  const linkField = ana.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await ana.locator(".k-dialog").getByRole("button", { name: "OK" }).click();
  await expect(ana.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await ana.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();

  await ana.goto("/?user=roster");
  await ana.locator(".k-tab", { hasText: "People" }).click();
  // Just Ana so far. THIS PAGE IS NEVER RELOADED AGAIN.
  await expect(ana.locator(".k-aggregate-row")).toHaveCount(1, { timeout: 30_000 });

  // ---- Bruno joins and writes something ----
  const ctxB = await browser.newContext();
  const bruno = await device(ctxB);
  await bruno.goto(link);
  await bruno.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(bruno.locator("h1").first()).toHaveText("Roster", { timeout: 60_000 });

  await bruno.getByRole("button", { name: /New Note|Add Note/i }).first().click();
  await bruno.getByLabel(/title/i).fill("Hello");
  await bruno.getByRole("button", { name: "Create" }).first().click();

  // ---- THE POINT: Ana's app now counts two members, with no reload ----
  // A snapshot would have kept saying 1 for the rest of the session.
  await expect(ana.locator(".k-aggregate-row")).toHaveCount(2, { timeout: 60_000 });

  await ctxA.close();
  await ctxB.close();
});
