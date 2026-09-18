import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// A message arriving says what it says.
//
// The Chat button used to grow a number, which tells you there is something to read and nothing
// about whether it can wait. Most of what people write in a shared app is one line — "got the
// milk", "running late" — so the line IS the notification: it appears in a balloon beside the
// button, with the sender's name, and two ways out — read it and dismiss, or open the conversation.

const SOURCE = `import { defineApp } from "karta";
export default defineApp({
  id: "talk", name: "Talk", version: "1.0.0", schemaVersion: 1,
  entities: { note: { label: "Note", icon: "📝", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" } } }],
});
`;

async function device(context: BrowserContext, seed = false): Promise<Page> {
  await context.addInitScript(
    ([source, s]) => {
      localStorage.setItem("karta:sync:relay", "ws://localhost:4201");
      if (!s || localStorage.getItem("karta:user-apps")) return;
      localStorage.setItem(
        "karta:user-apps",
        JSON.stringify([{ id: "talk", name: "Talk", source, trusted: true, updatedAt: new Date().toISOString() }]),
      );
    },
    [SOURCE, seed] as const,
  );
  return context.newPage();
}

test("a message arrives as a balloon on the Chat button, showing what was said", async ({ browser }) => {
  test.slow();

  // ---- Ana shares ----
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
  await expect(ana.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await ana.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(ana.locator(".k-chat-btn")).toBeVisible({ timeout: 60_000 });

  // ---- Bo joins and says something ----
  // Dark, because that is where the chat used to be unreadable: the bubble was a fixed 97%-light
  // colour and the ink on it follows the theme.
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 780 }, colorScheme: "dark" });
  const bo = await device(ctxB);
  await bo.goto(link);
  await bo.locator(".k-dialog").getByRole("button", { name: /Join and trust/ }).click();
  await answerNamePrompt(bo, "Bo");
  await expect(bo.locator("h1").first()).toHaveText("Talk", { timeout: 60_000 });
  await bo.locator(".k-chat-btn").click();
  await bo.getByRole("textbox", { name: /message/i }).fill("are we getting milk?");
  await bo.getByRole("button", { name: /^Send$/ }).click();

  // ---- Ana sees the message itself, not a number ----
  const peek = ana.locator(".k-chat-peek");
  await expect(peek).toBeVisible({ timeout: 60_000 });
  await expect(peek).toContainText("are we getting milk?");
  await expect(peek).toContainText("Bo");
  if (process.env.KARTA_SHOTS) {
    await ana.waitForTimeout(600);
    await ana.screenshot({ path: `${process.env.KARTA_SHOTS}/chat-peek-wide.png` });
  }

  // Dismissing leaves the count alone: it was not read, only put aside.
  await peek.getByRole("button", { name: "Dismiss this message" }).click();
  await expect(peek).toHaveCount(0);
  await expect(ana.locator(".k-chat-btn .k-activity-count")).toHaveText("1");

  // The NEXT message brings it back — dismissal is about one message, not about the balloon.
  await bo.getByRole("textbox", { name: /message/i }).fill("and bread");
  await bo.getByRole("button", { name: /^Send$/ }).click();
  await expect(peek).toBeVisible({ timeout: 60_000 });
  await expect(peek).toContainText("and bread");
  if (process.env.KARTA_SHOTS) await ana.screenshot({ path: `${process.env.KARTA_SHOTS}/chat-peek-second.png` });

  // Open goes to the conversation, where the whole thing is, and the balloon has done its job.
  await peek.getByRole("button", { name: "Open" }).click();
  await expect(ana.locator(".k-chat")).toBeVisible();
  await expect(ana.locator(".k-chat-list")).toContainText("are we getting milk?");
  await expect(peek).toHaveCount(0);

  // ---- And the same on a phone, where the button is in the top bar ----
  await bo.locator(".k-chat-modal").getByRole("button", { name: "Close" }).click();
  await ana.getByRole("textbox", { name: /message/i }).fill("yes, two litres");
  await ana.getByRole("button", { name: /^Send$/ }).click();
  const boPeek = bo.locator(".k-chat-peek");
  await expect(boPeek).toBeVisible({ timeout: 60_000 });
  await expect(boPeek).toContainText("yes, two litres");
  // On the screen it has least room, the balloon still fits inside it, under the button it hangs off.
  const box = (await boPeek.boundingBox())!;
  const button = (await bo.locator(".k-chat-btn").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThan(button.y + button.height - 1);
  if (process.env.KARTA_SHOTS) {
    await bo.waitForTimeout(600);
    await bo.screenshot({ path: `${process.env.KARTA_SHOTS}/chat-peek-phone.png` });
  }

  // ---- Readable in the dark: measured, not eyeballed ----
  await bo.locator(".k-chat-btn").click();
  await expect(bo.locator(".k-chat-list")).toContainText("yes, two litres");
  const contrast = await bo.evaluate(() => {
    // Painted, not parsed: these colours are written in oklch, and a regex that pulls numbers out of
    // "oklch(30% 0.04 60 / 0.92)" and calls them red, green and blue measures nothing (it reported a
    // ratio of 1.06 for text that is perfectly readable). A canvas resolves any CSS colour the
    // browser understands, and composites the alpha for free.
    const paint = (color: string, ...under: string[]): [number, number, number] => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const g = c.getContext("2d")!;
      for (const layer of under) {
        g.fillStyle = layer;
        g.fillRect(0, 0, 1, 1);
      }
      g.fillStyle = color;
      g.fillRect(0, 0, 1, 1);
      const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
      return [r!, gr!, b!];
    };
    const lum = (c: [number, number, number]): number => {
      const f = c.map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * f[0]! + 0.7152 * f[1]! + 0.0722 * f[2]!;
    };
    const ratio = (a: [number, number, number], b: [number, number, number]): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const msg = document.querySelector(".k-chat-msg")!;
    const style = (el: Element, prop: string): string => getComputedStyle(el).getPropertyValue(prop);
    const ground = style(document.querySelector(".k-chat-modal") ?? document.body, "background-color");
    const bubbleOver = [ground, style(msg, "background-color")];
    const bubble = paint(style(msg, "background-color"), ground);
    const avatar = msg.querySelector(".k-avatar")!;
    return {
      text: ratio(paint(style(msg.querySelector(".k-chat-text")!, "color"), ...bubbleOver), bubble),
      who: ratio(paint(style(msg.querySelector(".k-chat-who")!, "color"), ...bubbleOver), bubble),
      avatar: ratio(
        paint(style(avatar, "color"), ...bubbleOver, style(avatar, "background-color")),
        paint(style(avatar, "background-color"), ...bubbleOver),
      ),
    };
  });
  // WCAG AA for body text, and the name and the initials are small too.
  expect(contrast.text).toBeGreaterThanOrEqual(4.5);
  expect(contrast.who).toBeGreaterThanOrEqual(4.5);
  expect(contrast.avatar).toBeGreaterThanOrEqual(4.5);
  if (process.env.KARTA_SHOTS) await bo.screenshot({ path: `${process.env.KARTA_SHOTS}/chat-dark.png` });

  await ctxA.close();
  await ctxB.close();
});
