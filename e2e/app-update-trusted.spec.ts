import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// Adopting a collaborator's edit — and the WHITE PAGE that used to be.
//
// When someone you share an app with edits it, boot asks whether to take the update. That question
// goes through `shellDialogs.confirm`, whose promise settles only when a mounted `<Dialogs>` host
// renders the request and somebody answers. `bootUserApp` awaited it seventy lines before it mounted
// anything — so on a device with an update waiting, boot stopped at that await and the page stayed
// blank. Forever: the same update was still pending on the next reload.
//
// It needs TWO devices and an edit on one of them, which is why it survived nearly fifty commits.
// Every other spec that shared an app either never edited it afterwards or never reopened the other
// device. Nothing short of this shape can catch it: with one device there is no update to adopt, and
// a unit test cannot see whether a React tree exists to answer the question.

const STARTER = `import { defineApp } from "potyro";

export default defineApp({
  id: "shared-todo",
  name: "Shared Todo",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: { label: "Item", icon: "✅", displayField: "title", fields: { title: { type: "text", required: true } } },
  },
  pages: [{ id: "all", title: "Notes", view: { type: "list", entity: "item", display: { primary: "title" } } }],
});
`;

async function device(context: BrowserContext, opts?: { app?: boolean }): Promise<Page> {
  await context.addInitScript(
    ([source, seedApp]) => {
      localStorage.setItem("potyro:sync:relay", "ws://localhost:4201");
      if (!seedApp || localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "shared-todo", name: "Shared Todo", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [STARTER, opts?.app ?? false] as const,
  );
  return context.newPage();
}

test("a collaborator's edit is offered, not a blank page", async ({ browser }) => {
  test.slow();

  const ctxA = await browser.newContext();
  const a = await device(ctxA, { app: true });
  await a.goto("/?user=shared-todo");
  await expect(a.locator("h1").first()).toHaveText("Shared Todo", { timeout: 30_000 });

  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "Shared Todo", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(a, "Ana");
  const linkField = a.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await a.goto("/?user=shared-todo");
  await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 30_000 });

  // B joins.
  const ctxB = await browser.newContext();
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: /Join and trust/ }).click();
  await answerNamePrompt(b, "Bo");
  await expect(b.locator("h1").first()).toHaveText("Shared Todo", { timeout: 60_000 });

  // A edits the app — the thing the owner did (adding buttons to the list).
  await a.getByRole("button", { name: "Studio" }).click();
  const studio = a.locator(".k-studio");
  await studio.getByRole("button", { name: "Shared Todo", exact: true }).click();
  await studio.getByRole("tab", { name: "Source" }).click();
  const source = studio.getByRole("textbox", { name: "App source" });
  await expect(source).toContainText('title: "Notes"', { timeout: 30_000 });
  await source.fill(STARTER.replace('title: "Notes"', 'title: "Journal"'));
  await studio.getByRole("button", { name: "Save changes" }).click();
  // Wait on the SAVE, not on a clock. A fixed sleep here reloaded mid-write under a loaded parallel
  // run, so the newer source never reached the space and the whole spec failed downstream.
  await expect
    .poll(
      async () =>
        a
          .evaluate(() => {
            const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as { id: string; source: string }[];
            return apps.find((x) => x.id === "shared-todo")?.source ?? "";
          })
          .catch(() => ""),
      { timeout: 30_000 },
    )
    .toContain('title: "Journal"');

  await a.goto("/?user=shared-todo"); // publishing happens on open, once the space is up
  await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 30_000 });
  // A settle, and an honest one: publishing happens during A's boot and there is no page-visible
  // signal for "the space now holds the new source". If it has not landed when B loads, B simply
  // gets no update prompt and the assertion below fails loudly rather than silently passing.
  await a.waitForTimeout(1500);

  // ---- THE CLAIM: B reloads and gets a usable page. ----
  await b.goto("/?user=shared-todo");
  // The update prompt must be VISIBLE. `shellDialogs.confirm` only settles when <Dialogs> renders
  // it, and boot awaits this one long before anything is mounted — so an unmounted prompt is a
  // promise that never resolves, i.e. a permanently blank page.
  await expect(b.locator(".k-dialog")).toBeVisible({ timeout: 30_000 });
  await expect(b.locator(".k-dialog")).toContainText("updated");
  await b.locator(".k-dialog").getByRole("button", { name: "Update" }).click();
  await expect(b.locator("h1").first()).toHaveText("Shared Todo", { timeout: 60_000 });
  // And the app really did update — the renamed page is the one visible change.
  await expect(b.locator(".k-tab", { hasText: "Journal" })).toBeVisible({ timeout: 30_000 });

  await ctxA.close();
  await ctxB.close();
});
