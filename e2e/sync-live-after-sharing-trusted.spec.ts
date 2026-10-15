import { test, expect, type BrowserContext, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// Sharing an app you were already using, and then WATCHING it.
//
// Turning sync on moves an app into a different store, but the copy on screen was built on the old
// one — runtime, space and version gate are all made when an app opens. So the screen went on
// reading and writing the store nobody was syncing: the person you shared with could add to the
// list all day and you would never see it, and nothing you did reached them either. Switching to
// another app and back appeared to fix "sync", because that rebuilt everything on the new store.
//
// The other specs that share hide this, because every one of them navigates afterwards. This one
// deliberately does not: after the share dialog, Ana's page is left exactly where it was.

const SOURCE = `import { defineApp } from "potyro";
export default defineApp({
  id: "list", name: "Shared List", version: "1.0.0", schemaVersion: 1,
  entities: { item: { label: "Item", icon: "✓", displayField: "name", fields: {
    name: { type: "text", required: true },
    done: { type: "boolean", default: false },
  } } },
  pages: [
    { id: "all", title: "List", view: { type: "checklist", entity: "item", done: "done", text: "name", quickAdd: true } },
  ],
});
`;

async function device(context: BrowserContext, seed = false): Promise<Page> {
  await context.addInitScript(
    ([source, s]) => {
      localStorage.setItem("potyro:sync:relay", "ws://localhost:4201");
      if (!s || localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "list", name: "Shared List", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [SOURCE, seed] as const,
  );
  return context.newPage();
}

const add = async (page: Page, text: string): Promise<void> => {
  const input = page.getByRole("textbox", { name: "Add an item" });
  await input.fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("checkbox", { name: text })).toBeVisible({ timeout: 30_000 });
};

test("what the other person adds shows up on the page you shared from, with no navigation", async ({ browser }) => {
  test.slow();

  // ---- Ana is using her list, then shares it ----
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const a = await device(ctxA, true);
  await a.goto("/?user=list");
  await expect(a.locator("h1").first()).toHaveText("Shared List", { timeout: 30_000 });
  await add(a, "Bread");

  await a.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(a, "Shared List", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(a, "Ana");
  const field = a.locator(".k-dialog input");
  await expect(field).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await field.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  // The offer of recovery words, declined.
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();

  // From here Ana's page is NOT touched again: no goto, no reload, no tab. The app re-opens itself
  // on the synced store, and that is the whole point of the test.
  await expect(a.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });
  await expect(a.getByRole("checkbox", { name: "Bread" })).toBeVisible({ timeout: 60_000 });

  // ---- Bo joins on his phone and adds to it ----
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: /Join and trust/ }).click();
  await answerNamePrompt(b, "Bo");
  await expect(b.locator("h1").first()).toHaveText("Shared List", { timeout: 60_000 });
  await expect(b.getByRole("checkbox", { name: "Bread" })).toBeVisible({ timeout: 60_000 });
  await add(b, "Milk");
  await b.getByRole("checkbox", { name: "Bread" }).click();

  // ---- Ana sees both, where she was standing ----
  await expect(a.getByRole("checkbox", { name: "Milk" })).toBeVisible({ timeout: 60_000 });
  await expect(a.getByRole("checkbox", { name: "Bread" })).toHaveAttribute("aria-checked", "true", { timeout: 60_000 });

  // And it goes the other way too: what she does now reaches him.
  await add(a, "Coffee");
  await expect(b.getByRole("checkbox", { name: "Coffee" })).toBeVisible({ timeout: 60_000 });

  await ctxA.close();
  await ctxB.close();
});
