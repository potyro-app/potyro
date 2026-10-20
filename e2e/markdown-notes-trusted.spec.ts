import { test, expect } from "./console-guard";
import { addAsMine, packApp } from "./library-demos";
import { makeDemoLink, stranger } from "./share-demo";

// apps/markdown-notes, packed as its build packs it — with the four notes it ships with and the seed
// that points at them (#389): the app opens on notes, as files in its own folder, rendered from
// their markdown. What is checked is the rendered note, not that a file arrived.

test("Notes comes with four sample notes, files in its folder, rendered from markdown", async ({ page }) => {
  await addAsMine(page, "markdown-notes.potyro-app.zip", packApp("markdown-notes", "notes.app.tsx", ["--files", "files", "--seed", "seed.json"]));
  const rows = page.getByRole("main").locator(".k-list-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: "Welcome to Notes" })).toContainText("welcome-to-notes.md");

  await rows.filter({ hasText: "Sourdough" }).click();
  await expect(page.getByRole("heading", { name: "Sourdough, the short version" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ingredients" })).toBeVisible();
  await expect(page.getByText("100 g active starter")).toBeVisible();
  await expect(page.getByRole("list").filter({ hasText: "stretch and fold" })).toBeVisible();
});

// Edit is a screen of its own, not a box in a dialog: the whole page, a toolbar of marks above the
// text. A mark wraps what is typed next; Save writes the file and the note reads as marked.
test("Edit opens the note full screen with a markdown toolbar, and a mark reaches the saved note", async ({ page }) => {
  await addAsMine(page, "markdown-notes.potyro-app.zip", packApp("markdown-notes", "notes.app.tsx", ["--files", "files", "--seed", "seed.json"]));
  await page.getByRole("main").locator(".k-list-row").filter({ hasText: "Packing" }).click();
  await page.locator("article nav").getByRole("button", { name: "Edit", exact: true }).click();

  const text = page.getByRole("textbox", { name: "Note text" });
  await expect(text).toBeVisible();
  const toolbar = page.getByRole("toolbar", { name: "Markdown" });
  await expect(toolbar.getByRole("button", { name: /Bold/ })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: /Checklist/ })).toBeVisible();
  // The text fills the screen: no bars, and the box is most of the viewport's height.
  await expect(page.locator(".k-topbar")).toHaveCount(0);
  const box = (await text.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.height).toBeGreaterThan(viewport.height * 0.6);

  await text.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\nDo not forget the ");
  await toolbar.getByRole("button", { name: /Bold/ }).click();
  await page.keyboard.type("head torch");
  await expect(text).toHaveValue(/\*\*head torch\*\*$/);
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("heading", { name: "Packing for the mountains" })).toBeVisible();
  await expect(page.locator("strong", { hasText: "head torch" })).toBeVisible();
});

// The same editor where most people meet Notes: a demo link, the app sealed in its realm. The
// editor is a custom view, so it runs in its own sandboxed frame — full screen there too.
test("in a demo, sealed, Edit is the same full-screen editor and a save shows in the note", async ({ page, browser, baseURL }) => {
  await addAsMine(page, "markdown-notes.potyro-app.zip", packApp("markdown-notes", "notes.app.tsx", ["--files", "files", "--seed", "seed.json"]));
  const link = await makeDemoLink(page, "Notes");
  const { context, page: viewer } = await stranger(browser, baseURL!, { viewport: { width: 390, height: 844 } });
  await viewer.goto(link);
  await expect(viewer.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 15_000 });
  await viewer.getByRole("main").locator(".k-list-row").filter({ hasText: "Sourdough" }).click();

  const note = viewer.frameLocator(".k-sealed-view iframe").first();
  await expect(note.getByRole("heading", { name: "Ingredients" })).toBeVisible({ timeout: 15_000 });
  await note.locator("article nav").getByRole("button", { name: "Edit", exact: true }).click();

  const editor = viewer.frameLocator(".k-sealed-view iframe").first();
  const text = editor.getByRole("textbox", { name: "Note text" });
  await expect(text).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByRole("toolbar", { name: "Markdown" })).toBeVisible();
  const box = (await text.boundingBox())!;
  expect(box.height).toBeGreaterThan(844 * 0.6);

  await text.click();
  await viewer.keyboard.press("Control+End");
  await viewer.keyboard.type("\n\nSalt ");
  await editor.getByRole("toolbar", { name: "Markdown" }).getByRole("button", { name: /Italic/ }).click();
  await viewer.keyboard.type("after");
  await expect(text).toHaveValue(/\*after\*$/);
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(viewer.frameLocator(".k-sealed-view iframe").first().locator("em", { hasText: "after" })).toBeVisible({ timeout: 15_000 });
  await context.close();
});
