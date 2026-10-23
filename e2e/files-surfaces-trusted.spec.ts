import { test, expect, type Page } from "./console-guard";
import { tileAction } from "./launcher-actions.js";

// The shell's file surfaces (#254), in a real browser: an app's Files on the Data page (reached from
// its tile), a file dropped on Potyro landing in the app the person picks, an app dropped on Potyro
// going to Add an app, and the Studio's list of what an app ships with, saved as a package.
//
// Asserted on what the APP then reads, not only on the list: a file the panel shows but `ctx.files`
// cannot read would be worse than no panel.

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
      fields: { title: { type: "text", required: true }, doc: { type: "file", accept: ".md", folder: "notes" } },
    },
  },
  pages: [
    {
      id: "all",
      title: "Notes",
      actions: [
        {
          label: "What is in the folder",
          run: async (ctx) => {
            const files = await ctx.files.list();
            const texts = await Promise.all(files.map(async (f) => f.path + "=" + (await ctx.files.text(f))));
            ctx.ui.toast(texts.join(" | ") || "empty");
          },
        },
      ],
      view: { type: "list", entity: "note", display: { primary: "title" } },
    },
  ],
});
`;

async function seed(page: Page): Promise<void> {
  await page.addInitScript((source) => {
    if (localStorage.getItem("potyro:user-apps")) return;
    localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "notes-files", name: "Notes with files", source, trusted: true, updatedAt: new Date().toISOString() }]));
  }, APP);
}

/** Stand in for the native save dialog, which a headless run cannot answer; record what it is handed. */
async function catchSaves(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __saved?: Array<{ name: string; bytes: number[] }>; showSaveFilePicker: unknown };
    w.__saved = [];
    w.showSaveFilePicker = async ({ suggestedName }: { suggestedName: string }) => ({
      createWritable: async () => ({
        write: async (data: Blob) => void w.__saved!.push({ name: suggestedName, bytes: Array.from(new Uint8Array(await data.arrayBuffer())) }),
        close: async () => {},
      }),
    });
  });
}

/** Files held over the page and let go, as a desktop drag-and-drop does it. */
async function drop(page: Page, target: string, files: Array<{ name: string; type: string; body: string }>): Promise<void> {
  const dt = await page.evaluateHandle((fs) => {
    const d = new DataTransfer();
    for (const f of fs) d.items.add(new File([f.body], f.name, { type: f.type }));
    return d;
  }, files);
  await page.dispatchEvent(target, "dragenter", { dataTransfer: dt });
  await page.dispatchEvent(target, "dragover", { dataTransfer: dt });
  await page.dispatchEvent(target, "drop", { dataTransfer: dt });
}

/** What the app's own `ctx.files` lists and reads, as it says it in a toast. */
const folderAsTheAppReadsIt = async (page: Page) => {
  await page.goto("/?user=notes-files");
  await page.getByRole("button", { name: "What is in the folder" }).click();
  const toast = page.locator(".k-toast").last();
  await expect(toast).toBeVisible({ timeout: 30_000 });
  return toast;
};

test.use({ viewport: { width: 1280, height: 800 } });

test("a tile's Files: add, read, rename and delete — and the app reads what is there", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await tileAction(page, "Notes with files", "files");
  await expect(page).toHaveURL(/\?data=notes-files&files$/);
  const files = page.getByRole("region", { name: "Notes with files files" });
  await expect(files.getByRole("heading", { name: "No files yet" })).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await files.getByRole("button", { name: /Add files/ }).click();
  await (await chooser).setFiles([
    { name: "groceries.md", mimeType: "text/markdown", buffer: Buffer.from("# Groceries\n\nmilk, eggs") },
    { name: "plan.json", mimeType: "application/json", buffer: Buffer.from('{"weeks":3}') },
  ]);
  const row = (name: string) => files.locator(".k-files-row").filter({ hasText: name });
  await expect(row("groceries.md")).toContainText("added by you");
  await expect(page.getByRole("tab", { name: /Files/ })).toContainText("2");

  // Read-only viewer, with the file's text.
  await row("groceries.md").getByRole("button", { name: "Open groceries.md" }).click();
  const viewer = page.getByRole("dialog", { name: "groceries.md" });
  await expect(viewer.getByLabel("Contents of groceries.md")).toHaveText("# Groceries\n\nmilk, eggs");
  await catchSaves(page);
  await viewer.getByRole("button", { name: /Save a copy/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saved: Array<{ name: string }> }).__saved.map((s) => s.name))).toEqual(["groceries.md"]);
  await viewer.getByRole("button", { name: "Close groceries.md" }).click();

  // The same name again lands beside it, never over it.
  const again = page.waitForEvent("filechooser");
  await files.getByRole("button", { name: /Add files/ }).click();
  await (await again).setFiles([{ name: "groceries.md", mimeType: "text/markdown", buffer: Buffer.from("other") }]);
  await expect(row("groceries 2.md")).toBeVisible();

  // Rename into a folder, then delete the copy.
  await row("plan.json").getByRole("button", { name: "More for plan.json" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const name = page.getByRole("dialog").getByRole("textbox");
  // The prompt fills in the current name a moment after it opens; typing before that appends to it.
  await expect(name).toHaveValue("plan.json");
  await name.fill("data/plan.json");
  await page.getByRole("dialog").getByRole("button", { name: /OK|Save|Rename/ }).click();
  await expect(row("plan.json")).toContainText("data/");
  await row("groceries 2.md").getByRole("button", { name: "More for groceries 2.md" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(row("groceries 2.md")).toHaveCount(0);

  const said = await folderAsTheAppReadsIt(page);
  await expect(said).toContainText('data/plan.json={"weeks":3} | groceries.md=# Groceries');
  await expect(said).toContainText("milk, eggs");
  await expect(said).not.toContainText("groceries 2.md");
});

test("a file dropped on Potyro goes into the app the person picks", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Your data/ })).toBeVisible({ timeout: 30_000 });
  await drop(page, "body", [{ name: "trip.md", type: "text/markdown", body: "# Lisbon" }]);

  const ask = page.getByRole("dialog", { name: "Add this file to" });
  await expect(ask).toContainText("trip.md");
  // The app with a file field that takes .md is pointed out first.
  await expect(ask.locator(".k-share-app").first()).toContainText("Notes with files");
  await expect(ask.locator(".k-share-app").first()).toContainText("Takes these files");
  await ask.getByRole("button", { name: /Notes with files/ }).click();

  await expect(page).toHaveURL(/\?data=notes-files&files$/);
  await expect(page.locator(".k-files-row").filter({ hasText: "trip.md" })).toContainText("added by you");
  await expect(await folderAsTheAppReadsIt(page)).toHaveText("trip.md=# Lisbon");
});

test("an app dropped on Potyro goes to Add an app", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Your data/ })).toBeVisible({ timeout: 30_000 });
  await drop(page, "body", [{ name: "notes.app.ts", type: "text/plain", body: APP }]);
  const add = page.getByRole("dialog", { name: "Add an app" });
  await expect(add.getByText("Notes with files").first()).toBeVisible({ timeout: 30_000 });
  await expect(add.getByRole("button", { name: "Add app" })).toBeVisible();
});

test("a drop on an app's Files lands there, without asking which app", async ({ page }) => {
  await seed(page);
  await page.goto("/?data=notes-files&files");
  const panel = page.locator(".k-files");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await drop(page, ".k-files", [{ name: "here.txt", type: "text/plain", body: "here" }]);
  await expect(page.locator(".k-files-row").filter({ hasText: "here.txt" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Add this file to/ })).toHaveCount(0);
});

test("the Studio's Files: what the app ships with, saved as a package", async ({ page }) => {
  await seed(page);
  await page.goto("/?user=notes-files");
  await page.locator(".k-tools").getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Studio menu" }).click();
  await page.getByRole("menuitem", { name: "Files it comes with" }).click();
  const tools = page.getByRole("dialog", { name: "Code, files and history" });
  await expect(tools.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
  await expect(tools.getByRole("heading", { name: "Notes with files comes with no files yet" })).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await tools.getByRole("button", { name: /Add files/ }).click();
  await (await chooser).setFiles([{ name: "welcome.md", mimeType: "text/markdown", buffer: Buffer.from("# Welcome") }]);
  await expect(tools.locator(".k-files-row").filter({ hasText: "welcome.md" })).toBeVisible();

  await catchSaves(page);
  await tools.getByRole("button", { name: /Save as a package/ }).click();
  await expect(tools.getByRole("status")).toContainText("notes-files.potyro-app.zip");
  const saved = await page.evaluate(() => (window as unknown as { __saved: Array<{ name: string; bytes: number[] }> }).__saved);
  expect(saved.map((s) => s.name)).toEqual(["notes-files.potyro-app.zip"]);
  // A zip whose listing names the shipped file and the source.
  const listing = Buffer.from(saved[0]!.bytes).toString("latin1");
  expect(listing).toContain("files/welcome.md");
  expect(listing).toContain("app.tsx");
  expect(listing).toContain("manifest.json");
});
