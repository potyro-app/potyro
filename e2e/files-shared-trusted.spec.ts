import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { tileAction } from "./launcher-actions.js";
import { answerNamePrompt } from "./name-prompt.js";

// A shared app's files, on demand (#255), on two devices through a real relay.
//
// Two CONTEXTS — separate storage, separate identities — so this is two devices, not two tabs. What
// it holds the product to: the other member sees the file LISTED straight away and NOT fetched; it
// arrives when they open it; once here it opens with the relay out of reach; and a shipped file that
// an update of the app replaces reaches them too.

const RELAY = process.env.POTYRO_RELAY ?? "ws://localhost:4201";

const APP = `import { defineApp } from "potyro";
export default defineApp({
  id: "shelf",
  name: "Shelf",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { book: { label: "Book", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Books", view: { type: "list", entity: "book", display: { primary: "title" } } }],
});
`;

const file = (name: string, text: string, mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.from(text) });

async function device(context: BrowserContext): Promise<Page> {
  await context.addInitScript((relay) => localStorage.setItem("potyro:sync:relay", relay), RELAY);
  return context.newPage();
}

/** Add Shelf from this device, with a shipped reading list, as the person's own. */
async function addShelf(page: Page, list: string, update = false): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles([file("shelf.app.ts", APP), file("reading-list.md", list, "text/markdown")]);
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  if (!update) await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: update ? /Update|Replace|Add app/ : "Add app" }).click();
  await expect(page.locator(".k-app")).toBeVisible({ timeout: 30_000 });
}

const filesOf = (page: Page) => page.locator(".k-files");
const row = (page: Page, name: string) => filesOf(page).locator(".k-files-row").filter({ hasText: name });

test("a shared app's file is listed for the other member, arrives when opened, and stays", async ({ browser }) => {
  test.slow();

  // ---- A: adds Shelf (with its shipped reading list) and a file of their own, then shares it ----
  const ctxA = await browser.newContext();
  const a = await device(ctxA);
  await addShelf(a, "# To read\n\n- Dune");
  await a.goto("/");
  await tileAction(a, "Shelf", "share");
  await a.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click(); // sync on
  await answerNamePrompt(a);
  const linkField = a.locator(".k-dialog input");
  await expect(linkField).toHaveValue(/#join=/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await a.locator(".k-dialog").getByRole("button", { name: "Done" }).click();
  await expect(a.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await a.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();

  // A brings in a note of their own, into the folder that is now SHARED.
  await a.goto("/?data=shelf&files");
  const chooser = a.waitForEvent("filechooser");
  await filesOf(a).getByRole("button", { name: /Add files/ }).first().click();
  await (await chooser).setFiles([file("notes.txt", "lent Dune to Ana")]);
  await expect(row(a, "notes.txt")).toBeVisible();
  await expect(row(a, "notes.txt")).not.toHaveAttribute("data-away", "true");

  // ---- B: joins ----
  const ctxB = await browser.newContext();
  await ctxB.addInitScript(() => localStorage.setItem("potyro:space-budget", "200"));
  const b = await device(ctxB);
  await b.goto(link);
  await b.locator(".k-dialog").getByRole("button", { name: /Join and trust/ }).click();
  await answerNamePrompt(b);
  await expect(b.locator("h1").first()).toHaveText("Shelf", { timeout: 60_000 });

  // Listed at once, every one of them, and not one fetched.
  await b.goto("/?data=shelf&files");
  await expect(row(b, "notes.txt")).toBeVisible({ timeout: 60_000 });
  await expect(row(b, "reading-list.md")).toBeVisible({ timeout: 60_000 });
  await expect(row(b, "notes.txt")).toHaveAttribute("data-away", "true");
  await expect(row(b, "reading-list.md")).toHaveAttribute("data-away", "true");
  await expect(row(b, "reading-list.md")).toContainText("came with the app");
  // Someone in the app brought it in — not "you".
  await expect(row(b, "notes.txt")).toContainText("brought in");
  await expect(filesOf(b).locator(".k-files-summary")).toContainText("2 not on this device yet");

  // Opening it is what brings it.
  await row(b, "notes.txt").getByRole("button", { name: "Open notes.txt" }).click();
  const viewer = b.getByRole("dialog", { name: "notes.txt" });
  await expect(viewer.getByLabel("Contents of notes.txt")).toHaveText("lent Dune to Ana", { timeout: 60_000 });
  await viewer.getByRole("button", { name: "Close notes.txt" }).click();
  await expect(row(b, "notes.txt")).not.toHaveAttribute("data-away", "true");
  // The other one is still where it was: nothing came along with the first.
  await expect(row(b, "reading-list.md")).toHaveAttribute("data-away", "true");

  // ---- Once here, it opens with the relay out of reach ----
  // Every connection to the relay refused while blocked, passed through after.
  let blocked = true;
  await ctxB.routeWebSocket(new RegExp(new URL(RELAY).host), (ws) => (blocked ? ws.close() : void ws.connectToServer()));
  await b.reload();
  await expect(row(b, "notes.txt")).toBeVisible({ timeout: 60_000 });
  await expect(row(b, "notes.txt")).not.toHaveAttribute("data-away", "true");
  await row(b, "notes.txt").getByRole("button", { name: "Open notes.txt" }).click();
  await expect(b.getByRole("dialog", { name: "notes.txt" }).getByLabel("Contents of notes.txt")).toHaveText("lent Dune to Ana", { timeout: 30_000 });
  await b.getByRole("dialog", { name: "notes.txt" }).getByRole("button", { name: "Close notes.txt" }).click();
  // And the one never opened says it is not here, rather than hanging or reading as empty.
  await row(b, "reading-list.md").getByRole("button", { name: "Open reading-list.md" }).click();
  await expect(b.getByRole("dialog", { name: "reading-list.md" })).toContainText("not on this device yet");
  blocked = false;

  // ---- A updates Shelf with a new reading list; it reaches B ----
  await addShelf(a, "# To read\n\n- Dune\n- Solaris", true);
  await a.goto("/?data=shelf&files");
  await expect(row(a, "reading-list.md")).toContainText("27 B", { timeout: 30_000 });
  await b.reload();
  await row(b, "reading-list.md").getByRole("button", { name: "Open reading-list.md" }).click();
  await expect(b.getByRole("dialog", { name: "reading-list.md" }).getByLabel("Contents of reading-list.md")).toContainText("Solaris", { timeout: 60_000 });
  await b.getByRole("dialog", { name: "reading-list.md" }).getByRole("button", { name: "Close reading-list.md" }).click();

  // ---- The space's budget on the relay: shown, and a file past it is offered a place on B only ----
  // B was given a 200-byte budget (an override for this test); the space holds 17 + 16 + 27 bytes.
  await expect(filesOf(b).first().locator(".k-files-space")).toContainText("Shared space: 60 B of 200 B used");
  const big = b.waitForEvent("filechooser");
  await filesOf(b).first().getByRole("button", { name: /Add files/ }).first().click();
  await (await big).setFiles([file("too-big.txt", "x".repeat(500))]);
  const full = b.locator(".k-dialog", { hasText: "shared space is full" });
  await expect(full).toContainText("would not make room");
  await full.getByRole("button", { name: "Keep it on this device only" }).click();
  const deviceOnly = b.locator(".k-files-device");
  await expect(deviceOnly).toContainText("Only on this device");
  await expect(deviceOnly.locator(".k-files-row").filter({ hasText: "too-big.txt" })).toBeVisible();
  // Not in the shared folder, and the space used no more.
  await expect(filesOf(b).first().locator(".k-files-row")).toHaveCount(2);
  await expect(filesOf(b).first().locator(".k-files-space")).toContainText("60 B of 200 B");

  await ctxA.close();
  await ctxB.close();
});
