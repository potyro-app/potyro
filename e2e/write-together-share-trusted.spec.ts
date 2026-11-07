import { test, expect, type Browser, type BrowserContext, type Page } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";
import { answerNamePrompt } from "./name-prompt.js";
import { E2E_RELAY } from "./ports";

// One document shared on its own (docs/24 §12), through the real sync relay: Ana writes two
// documents and invites people to ONE of them. Bo opens the link with no Potyro app at all and is in
// the document at once, live, sealed; he writes, and Ana sees it; he sees nothing of her other
// document. Cy gets a read-only link and can look but not change. Everything is read off the screens.

let zip: Buffer;
test.beforeAll(() => {
  zip = packApp("write-together", "write-together.app.tsx");
});

async function device(browser: Browser, viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((relay) => localStorage.setItem("potyro:sync:relay", relay), E2E_RELAY);
  const page = await context.newPage();
  return { context, page };
}

import type { FrameLocator } from "@playwright/test";

/** Where an app's screen is: the page for Ana's own copy; the sealed frame for a stranger's viewer. */
type Screen = Page | FrameLocator;
const editor = (where: Screen) => where.getByRole("textbox", { name: "Write" });
/** A stranger's viewer runs the app sealed, its screens each in a frame of their own (#267). */
const sealed = (page: Page): FrameLocator => page.frameLocator(".k-sealed-view iframe");

/** Start a document named `title` and type `body` into it; back on the list afterwards. `screen` is where the editor is: the page, or a stranger's sealed frame. */
async function write(page: Page, title: string, body: string, screen: Screen = page): Promise<void> {
  await page.getByRole("button", { name: "New document" }).click();
  const prompt = page.locator(".k-dialog");
  await prompt.locator("input").fill(title);
  await prompt.getByRole("button", { name: "OK" }).click();
  await expect(editor(screen)).toBeVisible({ timeout: 30_000 });
  await editor(screen).click();
  await page.keyboard.type(body);
  await expect(editor(screen)).toHaveValue(body);
  await screen.getByRole("button", { name: "Documents" }).click({ noWaitAfter: true });
  await expect(page.locator(".k-list-row", { hasText: title })).toBeVisible({ timeout: 30_000 });
}

/** Invite from the open document: the role, the sync question the first time, then the link. */
async function invite(page: Page, role: "write" | "read", firstTime: boolean): Promise<string> {
  await page.getByRole("button", { name: "Invite" }).click();
  await page.getByRole("menu", { name: "Who can open this document?" }).getByRole("menuitem", { name: role === "write" ? "Anyone with the link can write" : "Anyone with the link can only read" }).click();
  if (firstTime) {
    // Sharing one record turns sync on for the app: asked, then a name, then the app comes back.
    await page.locator(".k-dialog").getByRole("button", { name: "Turn on sync" }).click();
    await answerNamePrompt(page, "Ana");
    await expect(page.locator(".k-sync-status")).toContainText("Synced", { timeout: 60_000 });
  }
  // The words and the link together, the link on its own line (as Draw & Guess's invite spec reads it).
  const sent = page.locator(".k-dialog").getByRole("textbox", { name: "What will be sent" });
  await expect(sent).toHaveValue(/rec=/, { timeout: 60_000 });
  const link = (await sent.inputValue()).split("\n").pop()!;
  await page.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  return link;
}

test("a document's link brings one document, live, to someone without the app — and nothing else", async ({ browser }) => {
  // Three devices and a relay between them: every step waits on sync.
  test.setTimeout(600_000);

  // ---- Ana: two documents; one of them shared ----
  const { context: ctxA, page: a } = await device(browser, { width: 1280, height: 800 });
  await addAsMine(a, "write-together.potyro-app.zip", zip);
  await write(a, "Plan", "Hello from Ana.");
  await write(a, "Private", "Nobody else sees this.");
  await a.locator(".k-list-row", { hasText: "Plan" }).click();
  await expect(editor(a)).toHaveValue("Hello from Ana.");
  const link = await invite(a, "write", true);
  // Back on the synced copy after the reload: both documents still there, the shared one open again.
  await expect(a.locator(".k-list-row")).toHaveCount(2, { timeout: 30_000 });
  await a.locator(".k-list-row", { hasText: "Plan" }).click();
  await expect(editor(a)).toHaveValue("Hello from Ana.", { timeout: 30_000 });

  await test.step("Ana shared Plan", async () => {});
  // ---- Bo: no app, no account he knows of; the link opens the document itself ----
  const { context: ctxB, page: bPage } = await device(browser, { width: 390, height: 780 });
  await bPage.goto(link);
  const b = sealed(bPage);
  await expect(editor(b)).toHaveValue("Hello from Ana.", { timeout: 90_000 });
  // Not a demo: the bar says what this is, and Keep is there from the start (not after minutes, as
  // for a link to a page) — the way to Bo's own Potyro, with the document in it.
  await expect(bPage.locator(".k-demo-bar")).toContainText("Shared with you: what you write here is kept");
  await expect(bPage.locator(".k-demo-bar").getByRole("button", { name: "Keep this app" })).toBeVisible();
  await editor(b).evaluate((el) => {
    const t = el as HTMLTextAreaElement;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  });
  await bPage.keyboard.type(" And Bo.");
  await expect(editor(b)).toHaveValue("Hello from Ana. And Bo.");
  await expect(editor(a)).toHaveValue("Hello from Ana. And Bo.", { timeout: 60_000 });
  // Bo's words wear a colour of their own on Ana's screen.
  await expect(a.locator(".wt-backdrop span[data-by]", { hasText: "And Bo." })).toBeVisible({ timeout: 30_000 });
  // Ana's reach Bo.
  await editor(a).evaluate((el) => {
    const t = el as HTMLTextAreaElement;
    t.focus();
    t.setSelectionRange(0, 0);
  });
  await a.keyboard.type("Note: ");
  await expect(editor(b)).toHaveValue("Note: Hello from Ana. And Bo.", { timeout: 60_000 });

  await test.step("Bo and Ana wrote in turn", async () => {});
  // Bo may comment, and Ana sees it.
  await editor(b).evaluate((el) => {
    const t = el as HTMLTextAreaElement;
    t.focus();
    const at = t.value.indexOf("Hello");
    t.setSelectionRange(at, at + 5);
  });
  await b.getByRole("button", { name: "+ Comment" }).click();
  await b.getByRole("textbox", { name: "Comment", exact: true }).fill("Hi back!");
  await b.getByRole("button", { name: "Add", exact: true }).click();
  await expect(a.getByRole("button", { name: "Comments" })).toContainText("1", { timeout: 60_000 });

  await test.step("Bo commented", async () => {});
  // Bo cannot invite anyone (only the document's maker can), and sees ONLY this document.
  await expect(b.getByRole("button", { name: "Invite" })).toHaveCount(0);
  await b.getByRole("button", { name: "Documents" }).click({ noWaitAfter: true });
  await expect(bPage.locator(".k-list-row", { hasText: "Plan" })).toBeVisible({ timeout: 30_000 });
  await expect(bPage.locator(".k-list-row")).toHaveCount(1);
  await expect(bPage.getByText("Private")).toHaveCount(0);

  await test.step("Bo sees one document", async () => {});
  // ---- Cy: a read-only link (Ana is still in the document) ----
  const readLink = await invite(a, "read", false);
  const { context: ctxC, page: cPage } = await device(browser, { width: 1180, height: 800 });
  await cPage.goto(readLink);
  const c = sealed(cPage);
  await expect(editor(c)).toHaveValue("Note: Hello from Ana. And Bo.", { timeout: 90_000 });
  await expect(editor(c)).toHaveAttribute("readonly", "");
  await editor(c).click();
  await cPage.keyboard.type("x");
  await expect(editor(c)).toHaveValue("Note: Hello from Ana. And Bo.");
  await expect(c.getByRole("button", { name: "+ Comment" })).toBeDisabled();
  await test.step("Cy can only read", async () => {});
  // Live for the reader too.
  await editor(a).evaluate((el) => {
    const t = el as HTMLTextAreaElement;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  });
  await a.keyboard.type(" Bye.");
  await expect(editor(c)).toHaveValue("Note: Hello from Ana. And Bo. Bye.", { timeout: 60_000 });

  await test.step("Cy reads live", async () => {});
  // ---- Bo, still in the viewer, starts a document of his own and invites Cy to it ----
  // The viewer's Invite used to hand over the words with no link in them (owner, 2026-11-07).
  await b.getByRole("button", { name: "Documents" }).click({ noWaitAfter: true });
  await expect(bPage.locator(".k-list-row", { hasText: "Plan" })).toBeVisible({ timeout: 30_000 });
  await write(bPage, "Bo's own", "Only Bo wrote this.", b);
  await bPage.locator(".k-list-row", { hasText: "Bo's own" }).click();
  await expect(editor(b)).toHaveValue("Only Bo wrote this.", { timeout: 30_000 });
  await b.getByRole("button", { name: "Invite" }).click();
  await b.getByRole("menu", { name: "Who can open this document?" }).getByRole("menuitem", { name: "Anyone with the link can write" }).click();
  const sentByBo = bPage.locator(".k-dialog").getByRole("textbox", { name: "What will be sent" });
  await expect(sentByBo).toHaveValue(/rec=/, { timeout: 60_000 });
  // The link alone, for an address bar: Copy link beside Copy.
  await expect(bPage.locator(".k-dialog").getByRole("button", { name: "Copy link" })).toBeVisible();
  const bosLink = (await sentByBo.inputValue()).split("\n").pop()!;
  await bPage.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await cPage.goto(bosLink);
  await expect(editor(sealed(cPage))).toHaveValue("Only Bo wrote this.", { timeout: 90_000 });
  await expect(cPage.locator(".k-list-row", { hasText: "Plan" })).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
