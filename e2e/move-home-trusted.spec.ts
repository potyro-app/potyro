import { test, expect, type Page } from "./console-guard";
import { PORTS } from "./ports";

// "Bring my apps over" (docs/16 §Moving to a new home), between TWO origins: this project's dev
// server plays the old site and a second dev server, on another port, plays the new home. Browser
// storage is per origin, so nothing the old one holds is visible to the new one — exactly the
// apps.vaz.io → potyro.app situation.
//
// The old site packs everything and hands it over by postMessage to a window it opens; the new one
// shows what will come in and takes it only after "Bring them in". Asserted on what the person sees
// AND on what is really there afterwards: the trusted app opens trusted with its record and its file
// (read back through `ctx.files`), the sealed app opens sealed with its record, the person is the
// same person, and a second move doubles nothing.
//
// Then the hostile half: a page that is not Potyro opens the new site and talks to it like an old
// one would. Nothing may come of it — not even the confirmation.

/** The new home: another origin. `POTYRO_MOVE_TO` names it; by default the sandbox project's server. */
const NEW = process.env.POTYRO_MOVE_TO ?? `http://localhost:${PORTS.sandbox}`;
const SHOTS = process.env.POTYRO_MOVE_SHOTS;

const NOTES = `import { defineApp } from "potyro";
export default defineApp({
  id: "notes-files",
  name: "Notes with files",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    note: {
      label: "Note",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        doc: { type: "file", accept: ".md,.txt", folder: "notes" },
      },
      actions: {
        readIt: async (n, ctx) => {
          ctx.ui.toast(n.doc ? ((await ctx.files.text(n.doc)) ?? "not here yet") : "no file");
        },
      },
    },
  },
  pages: [
    { id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" }, onOpen: { page: "note", param: { noteId: "id" } } } },
    { id: "note", title: "Note", hidden: true, view: { type: "detail", entity: "note", param: "noteId", actions: ["readIt"] } },
  ],
});
`;

const TALLY = `import { defineApp } from "potyro";
export default defineApp({
  id: "tally",
  name: "Tally",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { count: { label: "Count", displayField: "name", fields: { name: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Counts", view: { type: "list", entity: "count", display: { primary: "name" } } }],
});
`;

test.use({ viewport: { width: 1280, height: 860 } });

// The new home's dev server, warmed in a context of its own (so it holds none of the storage the
// popup will need): a cold Vite server optimises its dependencies on the first page and reloads it,
// which is a dev-server artefact that has nothing to do with moving apps.
test.beforeEach(async ({ browser }) => {
  const warm = await browser.newContext();
  try {
    const p = await warm.newPage();
    await p.goto(`${NEW}/?move`);
    await expect(p.getByRole("heading", { name: "Bring your apps in from a file" })).toBeVisible({ timeout: 60_000 });
  } finally {
    await warm.close();
  }
});

/** The old site: its two apps (one of them someone else's, so sealed) and its new home. */
async function seedOldSite(page: Page): Promise<void> {
  await page.addInitScript(
    ([notes, tally, newHome, oldOrigin]) => {
      if (location.origin !== oldOrigin) return;
      localStorage.setItem("potyro:dev:new-home", newHome);
      if (localStorage.getItem("potyro:user-apps")) return;
      const now = new Date().toISOString();
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([
          { id: "notes-files", name: "Notes with files", source: notes, trusted: true, updatedAt: now },
          { id: "tally", name: "Tally", source: tally, trusted: false, credit: { name: "Tally", by: "Bea" }, updatedAt: now },
        ]),
      );
    },
    [NOTES, TALLY, NEW, new URL(test.info().project.use.baseURL!).origin] as const,
  );
}

async function addNoteWithFile(page: Page): Promise<void> {
  await page.goto("/?user=notes-files");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  await page.getByRole("button", { name: "Add: Note" }).first().click();
  const form = page.getByRole("dialog");
  await form.getByRole("textbox", { name: "Title" }).fill("Groceries");
  await form.getByRole("button", { name: /Doc: choose a file/i }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /From this device/ }).click();
  await (await chooser).setFiles({ name: "hello.md", mimeType: "text/markdown", buffer: Buffer.from("# Hello\n\nmilk, eggs") });
  await expect(form.locator(".k-file-chip")).toContainText("hello.md");
  await form.getByRole("button", { name: /^(Create|Save)/ }).click();
  await openNote(page, "Groceries");
}

/** The note's detail page: already open after creating it, otherwise reached from the list. */
async function openNote(page: Page, title: string): Promise<void> {
  const detail = page.locator("article.k-detail, article").filter({ has: page.getByRole("heading", { name: title, level: 2 }) });
  const row = page.getByRole("listitem").filter({ hasText: title }).first();
  await expect(detail.or(row).first()).toBeVisible({ timeout: 30_000 });
  if (!(await detail.first().isVisible())) await row.click();
  await expect(detail.first()).toBeVisible({ timeout: 15_000 });
}

async function addCount(page: Page): Promise<void> {
  await page.goto("/?user=tally");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await page.getByRole("button", { name: "Add: Count" }).first().click();
  const form = page.getByRole("dialog");
  await form.getByRole("textbox", { name: "Name" }).fill("Push-ups");
  await form.getByRole("button", { name: /^(Create|Save)/ }).click();
  await expect(page.getByText("Push-ups").first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Press "Bring my apps over" and return the new home's window once it shows the confirmation. A move
 * after the first reuses the window the first one opened (`existing`): two tabs of one site would be
 * two tabs after one storage.
 */
async function bringOver(page: Page, button: RegExp, existing?: Page): Promise<Page> {
  const banner = page.locator(".k-move");
  let popup: Page;
  if (existing) {
    await banner.getByRole("button", { name: button }).click();
    await existing.waitForURL(/\?move=[0-9a-f]{32}/);
    popup = existing;
  } else {
    [popup] = await Promise.all([page.waitForEvent("popup"), banner.getByRole("button", { name: button }).click()]);
  }
  await expect(popup.locator(".k-move-offer")).toBeVisible({ timeout: 60_000 });
  return popup;
}

test("bring my apps over: a trusted app with a record and a file, and a sealed app, arrive on the new home", async ({ page }) => {
  test.slow();
  await seedOldSite(page);
  await addNoteWithFile(page);
  await addCount(page);
  const oldId = await page.evaluate(() => localStorage.getItem("potyro:identity:id"));
  expect(oldId).toMatch(/^co_/);

  // The banner, on the old site's home.
  await page.goto("/");
  const banner = page.locator(".k-move");
  await expect(banner.getByRole("heading", { name: /Bring your apps over to localhost:\d+/ })).toBeVisible({ timeout: 30_000 });
  if (SHOTS) await banner.screenshot({ path: `${SHOTS}/banner-${test.info().project.name}.png` });

  // The confirmation, on the new home: what will come in, before anything does.
  const popup = await bringOver(page, /Bring my apps over/);
  expect(new URL(popup.url()).origin).toBe(NEW);
  const offer = popup.locator(".k-move-offer");
  const notes = offer.locator(".k-move-app", { hasText: "Notes with files" });
  const tally = offer.locator(".k-move-app", { hasText: "Tally" });
  await expect(notes).toContainText("1 record");
  await expect(notes).toContainText("1 file");
  await expect(notes.getByText("sealed", { exact: true })).toHaveCount(0);
  await expect(tally.getByText("sealed", { exact: true })).toBeVisible();
  await expect(offer).toContainText("You come too");
  // Nothing has come in yet.
  expect(await popup.evaluate(() => (JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<{ id: string }>).some((a) => a.id === "notes-files"))).toBe(false);
  if (SHOTS) await popup.screenshot({ path: `${SHOTS}/confirm-${test.info().project.name}.png`, fullPage: true });

  await offer.getByRole("button", { name: "Bring them in" }).click();
  await expect(popup.getByRole("heading", { name: "Your apps are here" })).toBeVisible({ timeout: 60_000 });
  await expect(banner.getByRole("heading", { name: /Done — your apps are on localhost:\d+/ })).toBeVisible({ timeout: 15_000 });
  if (SHOTS) await banner.screenshot({ path: `${SHOTS}/done-${test.info().project.name}.png` });

  // The same person on both sites.
  expect(await popup.evaluate(() => localStorage.getItem("potyro:identity:id"))).toBe(oldId);

  // The trusted app runs trusted, with its record and its file — read back, not just listed.
  await popup.goto(`${NEW}/?user=notes-files`);
  await expect(popup.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  await openNote(popup, "Groceries");
  await expect(popup.locator("article .k-file-chip")).toContainText("hello.md");
  await popup.getByRole("button", { name: "Read It" }).click();
  await expect(popup.locator(".k-toast").last()).toContainText("milk, eggs", { timeout: 15_000 });

  // The sealed app runs sealed, with its record.
  await popup.goto(`${NEW}/?user=tally`);
  await expect(popup.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(popup.getByText("Push-ups").first()).toBeVisible({ timeout: 15_000 });

  // Again: everything joins what is there, and nothing is doubled.
  await page.bringToFront();
  const again = await bringOver(page, /Bring them over again/, popup);
  const rows = again.locator(".k-move-offer .k-move-app:not(.k-move-app-quiet)");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  await expect(again.locator(".k-move-offer").getByText("joins the one here")).toHaveCount(count);
  await again.locator(".k-move-offer").getByRole("button", { name: "Bring them in" }).click();
  await expect(again.getByRole("heading", { name: "Your apps are here" })).toBeVisible({ timeout: 60_000 });
  await again.goto(`${NEW}/?user=notes-files`);
  await expect(again.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  await expect(again.getByRole("listitem").filter({ hasText: "Groceries" })).toHaveCount(1);

  // And the old site still has it all.
  await page.goto("/?user=notes-files");
  await expect(page.getByRole("listitem").filter({ hasText: "Groceries" })).toHaveCount(1, { timeout: 30_000 });
});

test("saved as a file instead: every app comes in sealed, and who you are stays behind", async ({ page }) => {
  test.slow();
  // The plain download path, which is what a browser without the file-saving API takes.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  });
  await seedOldSite(page);
  await addNoteWithFile(page);
  await page.goto("/");
  const banner = page.locator(".k-move");
  const [download] = await Promise.all([page.waitForEvent("download"), banner.getByRole("button", { name: "Save them as a file instead" }).click()]);
  const file = await download.path();
  // The way there is a link to the page that takes a file — the address carries nothing else.
  const [there] = await Promise.all([page.waitForEvent("popup"), banner.getByRole("link", { name: /to bring the file in/ }).click()]);
  expect(new URL(there.url()).search).toBe("?move");
  await there.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  });
  await there.reload();
  const [chooser] = await Promise.all([there.waitForEvent("filechooser"), there.getByRole("button", { name: "Choose the file" }).click()]);
  await chooser.setFiles(file);
  const offer = there.locator(".k-move-offer");
  const notes = offer.locator(".k-move-app", { hasText: "Notes with files" });
  await expect(notes.getByText("sealed", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(offer).toContainText("Who you are does not come in a file");
  await offer.getByRole("button", { name: "Bring them in" }).click();
  await expect(there.getByRole("heading", { name: "Your apps are here" })).toBeVisible({ timeout: 60_000 });
  expect(await there.evaluate(() => localStorage.getItem("potyro:identity:id"))).toBeNull();
  await there.goto(`${NEW}/?user=notes-files`);
  await expect(there.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(there.getByRole("listitem").filter({ hasText: "Groceries" })).toHaveCount(1, { timeout: 15_000 });
});

test("a page that is not Potyro cannot push apps into the new home", async ({ page, context }) => {
  test.slow();
  const EVIL = "http://evil.test";
  await context.route(`${EVIL}/**`, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Not Potyro</title><h1>Totally Potyro</h1>" }));
  await page.goto(`${EVIL}/`);

  const channel = "0123456789abcdef0123456789abcdef";
  const [victim] = await Promise.all([
    page.waitForEvent("popup"),
    page.evaluate(([to, ch]) => {
      const w = window.open(`${to}/?move=${ch}`, "_blank");
      const forged = {
        format: "potyro-move/1",
        from: "https://apps.vaz.io",
        createdAt: new Date().toISOString(),
        apps: [{ id: "trojan", name: "Totally your app", source: "export default 1", trusted: true, wasShared: false, entities: [], records: 0, files: 0, missingFiles: 0 }],
        shared: {},
        conversations: 0,
        prefs: {},
      };
      const g = window as unknown as { hellos: number };
      g.hellos = 0;
      // Answer every hello the way an old Potyro would: an offer, and an archive pushed straight after.
      addEventListener("message", (ev) => {
        const d = ev.data as { step?: string; channel?: string } | null;
        if (d?.step !== "hello" || d.channel !== ch) return;
        g.hellos += 1;
        const base = { type: "potyro-move", v: 1, channel: ch };
        w?.postMessage({ ...base, step: "offer", offer: { manifest: forged, identity: null }, digest: "a".repeat(64), size: 1 }, "*");
        w?.postMessage({ ...base, step: "archive", bytes: new ArrayBuffer(8), digest: "a".repeat(64) }, "*");
      });
    }, [NEW, channel] as const),
  ]);

  // The new home did talk to it (its hello is content-free), so the forged answers really arrived —
  // and it goes on saying hello, which it stops doing the moment it takes an offer.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { hellos: number }).hellos), {
      timeout: 20_000,
      message: "the new home kept waiting: it took no offer from a page that is not Potyro",
    })
    .toBeGreaterThan(3);
  // …and were ignored: still waiting, no confirmation, nothing brought in.
  await expect(victim.getByRole("heading", { name: "Getting your apps ready…" })).toBeVisible();
  await expect(victim.locator(".k-move-offer")).toHaveCount(0);
  await expect(victim.getByRole("button", { name: "Bring them in" })).toHaveCount(0);
  expect(await victim.evaluate(() => localStorage.getItem("potyro:user-apps") ?? "")).not.toContain("trojan");
});
