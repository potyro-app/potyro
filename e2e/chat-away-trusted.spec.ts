import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// A message that arrives while the app is NOT RUNNING, announced when it comes back.
//
// Reported: two browsers on one Android phone, so the receiving one is backgrounded — and Android
// discards backgrounded tabs. "When I switch to the other browser it doesn't popup any
// notification if the chat is closed. But if I open the chat the new message is there."
//
// The suite had never covered this. `chat-peek-trusted.spec.ts` keeps the receiver open and on a
// 1280x800 desktop; here the receiver is a phone whose page is destroyed before the message is
// sent, and the assertion is what it shows on its own when it comes back — the balloon and the
// count, without anyone opening the conversation.

const SOURCE = `import { defineApp } from "potyro";
export default defineApp({
  id: "talk", name: "Talk", version: "1.0.0", schemaVersion: 1,
  entities: { note: { label: "Note", icon: "📝", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" } } }],
});
`;

async function device(context: BrowserContext, seed = false): Promise<Page> {
  await context.addInitScript(
    ([source, s]) => {
      localStorage.setItem("potyro:sync:relay", "ws://localhost:4201");
      if (!s || localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "talk", name: "Talk", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [SOURCE, seed] as const,
  );
  return context.newPage();
}

test("a message that arrives while the app is AWAY is announced when it comes back", async ({ browser }) => {
  test.slow();

  // Ana on a phone — the reported setup is two browsers on one Android, so the receiver is a phone
  // whose tab is not in front when the message arrives.
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const ana = await device(ctxA, true);
  await ana.goto("/?user=talk");
  await expect(ana.locator("h1").first()).toHaveText("Talk", { timeout: 30_000 });
  await ana.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(ana, "Talk", "share");
  await ana.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await answerNamePrompt(ana, "Ana");
  const field = ana.locator(".k-dialog input");
  await expect(field).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await field.inputValue();
  await ana.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  const after = ana.locator(".k-dialog");
  if (await after.isVisible().catch(() => false)) await after.getByRole("button", { name: "Cancel" }).click().catch(() => {});
  await ana.goto("/?user=talk");
  await expect(ana.locator(".k-chat-btn")).toBeVisible({ timeout: 60_000 });

  const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const bo = await device(ctxB);
  await bo.goto(link);
  await bo.locator(".k-dialog").getByRole("button", { name: /Join and trust/ }).click();
  await answerNamePrompt(bo, "Bo");
  await expect(bo.locator("h1").first()).toHaveText("Talk", { timeout: 60_000 });

  // ---- Ana goes away: the tab is gone, the way Android discards a backgrounded one ----
  await ana.close();

  await bo.locator(".k-chat-btn").click();
  await bo.getByRole("textbox", { name: /message/i }).fill("are we getting milk?");
  await bo.getByRole("button", { name: /^Send$/ }).click();
  await bo.waitForTimeout(3000);

  // ---- Ana comes back ----
  const ana2 = await ctxA.newPage();
  await ana2.goto("/?user=talk");
  await expect(ana2.locator("h1").first()).toHaveText("Talk", { timeout: 60_000 });

  // What she should see WITHOUT opening the chat: the message, said out loud.
  await expect(ana2.locator(".k-chat-peek")).toBeVisible({ timeout: 60_000 });
  await expect(ana2.locator(".k-chat-peek")).toContainText("are we getting milk?");
  await expect(ana2.locator(".k-chat-btn .k-activity-count")).toHaveText("1");

  await ctxA.close();
  await ctxB.close();
});
