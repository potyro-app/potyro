import { test, expect, type Page } from "./console-guard";

// The app's own folder (#252), in a real browser, trusted and in the sealed box.
//
// A note has a `file` field. The person brings a markdown file in through the system file dialog;
// the chip names it; an action reads it back through `ctx.files`. Then the page is reloaded and the
// same file is still there, by name AND by contents — an entry that survived without its bytes would
// show the chip and fail the read, which is why the read is part of the assertion.

const APP = `import { defineApp } from "potyro";
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
        writeSummary: async (n, ctx) => {
          const f = await ctx.files.write("notes/summary.md", "# Summary of " + n.title);
          await ctx.patch("note", n.id, { doc: { id: f.id, path: f.path, name: f.name, mime: f.mime } });
        },
      },
    },
  },
  pages: [
    { id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" }, onOpen: { page: "note", param: { noteId: "id" } } } },
    { id: "note", title: "Note", hidden: true, view: { type: "detail", entity: "note", param: "noteId", actions: ["readIt", "writeSummary"] } },
  ],
});
`;

async function install(page: Page, trusted: boolean): Promise<void> {
  await page.addInitScript(
    ([source, t]) => {
      if (localStorage.getItem("potyro:user-apps")) return;
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([{ id: "notes-files", name: "Notes with files", source, trusted: t, updatedAt: new Date().toISOString() }]),
      );
    },
    [APP, trusted] as const,
  );
  await page.goto("/?user=notes-files");
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", trusted ? "trusted" : "untrusted", { timeout: 30_000 });
}

/** The note's detail page: already open after creating it or a reload, otherwise reached from the list. */
async function openNote(page: Page, title: string): Promise<void> {
  const detail = page.locator("article.k-detail, article").filter({ has: page.getByRole("heading", { name: title, level: 2 }) });
  const row = page.getByRole("listitem").filter({ hasText: title }).first();
  await expect(detail.or(row).first()).toBeVisible({ timeout: 30_000 });
  if (!(await detail.first().isVisible())) await row.click();
  await expect(detail.first()).toBeVisible({ timeout: 15_000 });
}

test.use({ viewport: { width: 1280, height: 800 } });

for (const trusted of [true, false]) {
  const how = trusted ? "trusted" : "in the sealed box";

  test(`a file brought in through a file field is named, readable, and still both after a reload — ${how}`, async ({ page }) => {
    await install(page, trusted);

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
    await expect(page.locator("article .k-file-chip")).toContainText("hello.md");
    await page.getByRole("button", { name: "Read It" }).click();
    // A toast is one line: the file's blank line collapses, so check both ends of the contents.
    await expect(page.locator(".k-toast").last()).toContainText("# Hello");
    await expect(page.locator(".k-toast").last()).toContainText("milk, eggs");

    await page.reload();
    await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", trusted ? "trusted" : "untrusted", { timeout: 30_000 });
    await openNote(page, "Groceries");
    await expect(page.locator("article .k-file-chip")).toContainText("hello.md");
    await expect(page.locator("article .k-file-size")).toHaveText("19 B");
    await page.getByRole("button", { name: "Read It" }).click();
    await expect(page.locator(".k-toast").last()).toContainText("milk, eggs");
  });

  test(`a file an action writes is linked, survives a reload, and saves a copy outside — ${how}`, async ({ page }) => {
    await install(page, trusted);

    await page.getByRole("button", { name: "Add: Note" }).first().click();
    const form = page.getByRole("dialog");
    await form.getByRole("textbox", { name: "Title" }).fill("Trip");
    await form.getByRole("button", { name: /^(Create|Save)/ }).click();
    await openNote(page, "Trip");

    await page.getByRole("button", { name: "Write Summary" }).click();
    await expect(page.locator("article .k-file-chip")).toContainText("summary.md");

    await page.reload();
    await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", trusted ? "trusted" : "untrusted", { timeout: 30_000 });
    await openNote(page, "Trip");
    await page.getByRole("button", { name: "Read It" }).click();
    await expect(page.locator(".k-toast").last()).toHaveText("# Summary of Trip");

    // Chromium has the native save dialog, which a headless run cannot answer. Stand in for it and
    // check what the shell hands it: the file's own name, and its contents.
    await page.evaluate(() => {
      const w = window as unknown as { __saved?: { name: string; text: string }; showSaveFilePicker: unknown };
      w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({
        createWritable: async () => ({
          write: async (data: Blob) => void (w.__saved = { name: suggestedName, text: await data.text() }),
          close: async () => {},
        }),
      });
    });
    await page.getByRole("button", { name: "Save a copy of summary.md" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __saved?: unknown }).__saved)).toEqual({
      name: "summary.md",
      text: "# Summary of Trip",
    });
  });
}
