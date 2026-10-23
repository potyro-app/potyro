import { test, expect } from "../console-guard";
import { openApp, openHome, seed } from "./fixture.js";
import { tileAction } from "../launcher-actions.js";

// A picture as an app's icon (#425): an inline <svg> or a data: image written in the source is shown
// as an <img> on the Home card, in the app's top-bar mark and on its splash — never inserted as
// markup, so a script inside it is nothing. A picture that names a file the app ships (`icon:
// "icon.svg"`) is the monogram until the app has opened and the file was read.

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SVG = '<svg viewBox="0 0 24 24"><script>window.__pwned = 1</script><circle cx="12" cy="12" r="10" fill="#c92b70"/></svg>';

const app = (id: string, name: string, icon: string) => ({
  id,
  name,
  source:
    `import { defineApp } from "potyro";\nexport default defineApp({ id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, icon: ${JSON.stringify(icon)}, version: "1.0.0", schemaVersion: 1,\n` +
    `  entities: { item: { fields: { title: { type: "text" } } } },\n` +
    // An action that puts the picture the icon names into the app's files, so the shipped-file case can be seen end to end.
    `  pages: [{ id: "all", title: "Items", actions: [{ label: "Make icon", run: async (ctx) => { await ctx.files.write("icon.svg", ${JSON.stringify(SVG)}, { mime: "image/svg+xml" }); } }], view: { type: "list", entity: "item" } }] });\n`,
  updatedAt: new Date(0).toISOString(),
  trusted: true,
});

const tile = (page: import("@playwright/test").Page, name: string) => page.locator(".k-launch-tile", { hasText: name });

test("an inline <svg> and a data: image are the card's picture, and a shipped file's path waits for the app", async ({ page }) => {
  await seed(page, [app("dots", "Dots", SVG), app("pixel", "Pixel", PNG), app("shop", "Corner shop", "icon.svg")]);
  await openHome(page);

  const dots = tile(page, "Dots").locator(".k-launch-avatar img.k-glyph-image");
  await expect(dots).toBeVisible();
  expect(await dots.getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,/);
  // Shown, not inserted: the script in it never ran, and the markup is nowhere in the page.
  expect(decodeURIComponent((await dots.getAttribute("src"))!)).not.toContain("<script");
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await page.locator(".k-launch-tile script").count()).toBe(0);

  const pixel = tile(page, "Pixel").locator(".k-launch-avatar img.k-glyph-image");
  await expect(pixel).toHaveAttribute("src", PNG);

  // No file to read yet: the monogram, never the path as text.
  const shop = tile(page, "Corner shop").locator(".k-launch-avatar");
  await expect(shop).toHaveAttribute("data-kind", "monogram");
  await expect(shop).not.toContainText("icon.svg");

  // Inside the app the same picture is its mark.
  await openApp(page, "pixel", "Pixel");
  await expect(page.locator(".k-app-mark img.k-glyph-image").first()).toHaveAttribute("src", PNG);
});

test("a picture the app ships is read when the app opens, then the card and the mark wear it", async ({ page }) => {
  await seed(page, [app("shop", "Corner shop", "icon.svg")]);
  await openApp(page, "shop", "Corner shop");
  // Not there yet: the mark falls back to the initials.
  await expect(page.locator(".k-app-mark").first()).toHaveText("CS");
  await page.getByRole("button", { name: "Make icon" }).click();
  // The write is the action's own, async: give it a moment before opening the app again.
  await page.waitForTimeout(1000);
  // Opening the app again reads the file into the launcher's copy and shows it in the mark.
  await page.reload();
  await expect(page.locator("h1").first()).toHaveText("Corner shop", { timeout: 30_000 });
  const mark = page.locator(".k-app-mark img.k-glyph-image").first();
  await expect(mark).toBeVisible();
  // Through the app's own files here; the launcher keeps a small `data:` copy for the card.
  expect(await mark.getAttribute("src")).toMatch(/^blob:/);
  await openHome(page);
  const shop = tile(page, "Corner shop").locator(".k-launch-avatar");
  await expect(shop).toHaveAttribute("data-kind", "icon");
  expect(await shop.locator("img.k-glyph-image").getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,/);
});

test("a person picks a picture of their own for a tile (#83): it is on the card at once and after a reload", async ({ page }) => {
  await seed(page);
  await openHome(page);
  await tileAction(page, "Groceries", "edit-tile");
  const dialog = page.getByRole("dialog", { name: "Edit tile: Groceries" });
  await expect(dialog).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Picture…" }).click();
  await (await chooser).setFiles({ name: "me.png", mimeType: "image/png", buffer: Buffer.from(PNG.split(",")[1]!, "base64") });
  // The preview wears it, made small as a PNG; the text box gives way to a word.
  await expect(dialog.locator(".k-tile-editor-preview img.k-glyph-image")).toBeVisible();
  await expect(dialog.getByText("Your picture")).toBeVisible();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  const avatar = tile(page, "Groceries").locator(".k-launch-avatar img.k-glyph-image");
  await expect(avatar).toBeVisible();
  expect(await avatar.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  await page.reload();
  await expect(tile(page, "Groceries").locator(".k-launch-avatar img.k-glyph-image")).toBeVisible();
});
