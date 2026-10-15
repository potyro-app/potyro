import { test, expect, type BrowserContext, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// APP CODE must see the space as it is now, not as it was at boot (KA-36 follow-up).
//
// `ctx.space` was captured once when the app opened, so a page opened before someone joined listed
// only the people who were there then — for the rest of the session. That is not just an activity-feed
// problem: any app reading `ctx.space.members` itself hits it — a split-among default, a person
// picker, "who is in this list".
//
// The app below renders its members through an `aggregate` view, so what is asserted is genuinely
// what APP CODE sees, not what the shell renders on its behalf.

const STARTER = `import { defineApp } from "potyro";

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
      localStorage.setItem("potyro:sync:relay", "ws://localhost:4201");
      if (!seedApp || localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([
          { id: "roster", name: "Roster", source, trusted: true, updatedAt: new Date().toISOString() },
        ]),
      );
    },
    [STARTER, opts?.app ?? false] as const,
  );
  return context.newPage();
}

test("an app sees a new member without reloading, even if they write nothing", async ({ browser }) => {
  test.slow();

  const ctxA = await browser.newContext();
  const ana = await device(ctxA, { app: true });
  await ana.goto("/?user=roster");
  await expect(ana.locator("h1").first()).toHaveText("Roster", { timeout: 30_000 });

  // Share (which turns sync on), then come back to the app and open the People page.
  await ana.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(ana, "Roster", "share");
  await ana.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(ana, "Ana");
  const linkField = ana.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await ana.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
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
  await bruno.locator(".k-dialog").getByRole("button", { name: /Join, run it as yours/ }).click();
  await answerNamePrompt(bruno, "Bruno");
  await expect(bruno.locator("h1").first()).toHaveText("Roster", { timeout: 60_000 });

  // ---- THE POINT: Ana's app counts two members with no reload AND NO WRITE ----
  //
  // Bruno has joined and touched nothing. Views re-run on `Store.subscribe`, which fires for writes,
  // and a join is not a write — so this used to stay at 1 until some unrelated edit happened along.
  // Membership now raises the runtime's invalidation signal in its own right.
  await expect(ana.locator(".k-aggregate-row")).toHaveCount(2, { timeout: 60_000 });

  // And a later write still works, i.e. the two sources coexist rather than one replacing the other.
  await bruno.getByRole("button", { name: /Add: Note|Add Note/i }).first().click();
  await bruno.getByLabel(/title/i).fill("Hello");
  await bruno.getByRole("button", { name: "Create" }).first().click();
  await ana.locator(".k-tab", { hasText: "Notes" }).click();
  await expect(ana.locator(".k-list-row", { hasText: "Hello" })).toBeVisible({ timeout: 60_000 });

  await ctxA.close();
  await ctxB.close();
});
