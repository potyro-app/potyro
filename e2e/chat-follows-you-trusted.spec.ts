import { test, expect, type BrowserContext, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";
import { E2E_RELAY } from "./ports";

// The Studio's conversation follows the person across their own devices (#283) — and only theirs.
//
// Three browsers on one relay: A owns a synced app, B is A's second device (linked with the recovery
// words), C is someone A shared the app with. What A says to the Studio about the app reaches B, the
// next time B opens the Studio, through a map only A's account can read. C is in the app's space —
// that is what sharing is — and that is exactly why the conversation does not go there: C, opening the
// same app's Studio, sees none of it.

const RELAY = process.env.POTYRO_E2E_RELAY ?? E2E_RELAY;
const ASKED = "remind me what the second page was for";
const QUESTION = "Which page do you mean — Notes, or a new one?";

const SOURCE = `import { defineApp } from "potyro";
export default defineApp({
  id: "notes", name: "Notes", icon: "📝", version: "1.0.0", schemaVersion: 1,
  entities: { note: { label: "Note", icon: "📝", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" } } }],
});
`;

async function device(browser: import("@playwright/test").Browser, seed = false): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(
    ([source, s, relay]) => {
      localStorage.setItem("potyro:sync:relay", relay);
      localStorage.setItem("potyro:generator:engine", JSON.stringify({ engine: "cli" }));
      if (!s || localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "notes", name: "Notes", source, trusted: true, updatedAt: new Date().toISOString() }]));
    },
    [SOURCE, seed, RELAY] as const,
  );
  return { context, page: await context.newPage() };
}

/** The dev server's generate endpoint, answering every request with the same question. */
async function stubGenerator(page: Page): Promise<void> {
  let n = 0;
  await page.route("**/__generate**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ id: `job-${++n}` }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "done", text: `QUESTION: ${QUESTION}` }) });
  });
}

async function openStudio(page: Page) {
  await page.goto("/?user=notes");
  await expect(page.locator("h1").first()).toHaveText("Notes", { timeout: 60_000 });
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  const studio = page.locator(".k-studio");
  await expect(studio.getByRole("textbox", { name: "Describe the app" })).toBeVisible({ timeout: 30_000 });
  return studio;
}

test.use({ actionTimeout: 30_000 });

test("a Studio conversation reaches your other device, and not the person you share the app with", async ({ browser }) => {
  test.setTimeout(420_000);
  const a = await device(browser, true);
  const b = await device(browser);
  const c = await device(browser);
  try {
    // ---- A: the app, synced and shared ----
    await a.page.goto("/?user=notes");
    await expect(a.page.locator("h1").first()).toHaveText("Notes", { timeout: 30_000 });
    await a.page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
    await tileAction(a.page, "Notes", "share");
    await a.page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
    await answerNamePrompt(a.page, "Ana");
    const linkField = a.page.locator(".k-dialog input");
    await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
    const link = await linkField.inputValue();
    await a.page.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
    await expect(a.page.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
    await a.page.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();

    // ---- C: someone A shares it with ----
    await c.page.goto(link);
    await c.page.locator(".k-dialog").getByRole("button", { name: /Join, run it as yours/ }).click();
    await answerNamePrompt(c.page, "Caio");
    await expect(c.page.locator("h1").first()).toHaveText("Notes", { timeout: 60_000 });

    // ---- A says something to the Studio about the app ----
    await stubGenerator(a.page);
    const studioA = await openStudio(a.page);
    await studioA.getByRole("textbox", { name: "Describe the app" }).fill(ASKED);
    await studioA.getByRole("button", { name: /Modify the app/ }).click();
    await expect(studioA.locator('.k-thread-answer[data-tone="question"]')).toContainText(QUESTION, { timeout: 60_000 });

    // ---- B: A's second device, linked with the words ----
    await a.page.goto("/");
    await expect(a.page.locator(".k-launcher-home")).toBeVisible({ timeout: 30_000 });
    const devices = a.page.getByRole("button", { name: "You and your devices" });
    if (!(await devices.isVisible())) await a.page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
    await devices.click();
    await a.page.getByRole("button", { name: /Add a device/ }).click();
    const words = (await a.page.locator(".k-passphrase").innerText({ timeout: 30_000 })).trim();

    await b.page.goto("/");
    await b.page.getByRole("button", { name: "You and your devices" }).click();
    await b.page.getByRole("button", { name: /This is my second device/ }).click();
    const field = b.page.locator(".k-dialog input");
    await expect(field).toBeVisible({ timeout: 30_000 });
    await field.fill(words);
    await b.page.locator(".k-dialog").getByRole("button", { name: "OK" }).click();
    const offer = b.page.locator(".k-restore");
    await expect(offer).toBeVisible({ timeout: 60_000 });
    await offer.getByRole("button", { name: /^Load/ }).click();
    await expect(b.page.locator(".k-launch-tile", { hasText: "Notes" }).first()).toBeVisible({ timeout: 60_000 });

    // THE CLAIM, half one: B's Studio for the app has A's conversation — what was asked, and the
    // question the agent answered with.
    const studioB = await openStudio(b.page);
    const threadB = studioB.locator(".k-thread");
    await expect(threadB).toContainText(ASKED, { timeout: 60_000 });
    await expect(threadB).toContainText(QUESTION);

    // Half two: C's Studio for the same app has none of it. B has just shown it is on the account and
    // reachable; C is given longer than B needed, and a second look, before the absence counts.
    const studioC = await openStudio(c.page);
    await expect(studioC.locator(".k-studio-name")).toHaveText("Notes", { timeout: 60_000 });
    await c.page.waitForTimeout(8_000);
    await expect(studioC.locator(".k-thread")).not.toContainText(ASKED);
    const again = await openStudio(c.page);
    await c.page.waitForTimeout(4_000);
    await expect(again.locator(".k-thread")).not.toContainText(ASKED);
    await expect(again.locator(".k-thread")).not.toContainText(QUESTION);
  } finally {
    await a.context.close();
    await b.context.close();
    await c.context.close();
  }
});
