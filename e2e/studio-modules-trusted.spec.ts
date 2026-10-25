import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./console-guard";
import { addAsMine } from "./library-demos";
import { openHistory, openSource } from "./studio-helpers.js";

// An app made of two files (#258) in the Studio (#448): the code lists both, a module is edited and
// saved like the entry file, the app runs the edit, History shows it as a change to that file, and
// restoring the first version puts its module back — the app shows the first words again.

const APP = `import { defineApp } from "potyro";
import { EMPTY } from "./words.ts";

export default defineApp({
  id: "two-files",
  name: "Two files",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { note: { label: "Note", displayField: "text", fields: { text: { type: "text", required: true, label: "Text" } } } },
  pages: [{ id: "notes", title: "Notes", view: { type: "list", entity: "note", emptyText: EMPTY } }],
});
`;
const WORDS_V1 = 'export const EMPTY = "First words, from the module.";\n';
const WORDS_V2 = 'export const EMPTY = "Second words, edited in the Studio.";\n';

function packTwoFiles(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "two-files-"));
  writeFileSync(join(dir, "two-files.app.ts"), APP);
  writeFileSync(join(dir, "words.ts"), WORDS_V1);
  const out = join(dir, "two-files.potyro-app.zip");
  execFileSync(process.execPath, [join(process.cwd(), "scripts/pack-app.mjs"), "two-files.app.ts", "-o", out], { cwd: dir, env: { ...process.env, INIT_CWD: dir } });
  return readFileSync(out);
}

test("a module is listed, edited and saved in the Studio, and restoring a version puts its module back", async ({ page }) => {
  await addAsMine(page, "two-files.potyro-app.zip", packTwoFiles());
  await expect(page.getByText("First words, from the module.")).toBeVisible();

  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  const tools = await openSource(page, studio);
  const files = tools.getByRole("navigation", { name: "The app's files" });
  await expect(files.getByRole("button", { name: /^The app/ })).toHaveAttribute("aria-current", "true");
  await files.getByRole("button", { name: "words.ts", exact: true }).click();
  const words = tools.getByRole("textbox", { name: "words.ts" });
  await expect(words).toContainText("First words, from the module.");
  await words.fill(WORDS_V2);
  await expect(files.getByRole("button", { name: /^words\.ts/ })).toHaveAttribute("data-changed", "true");
  if (process.env.SHOT) {
    await page.screenshot({ path: `${process.env.SHOT}-wide.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.SHOT}-phone.png` });
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await tools.getByRole("button", { name: "Save changes" }).click();
  await expect(files.getByRole("button", { name: /^words\.ts/ })).not.toHaveAttribute("data-changed", "true", { timeout: 30_000 });

  // The app, opened again from what was saved, runs the edited module.
  await page.goto("/?user=two-files");
  await expect(page.getByText("Second words, edited in the Studio.")).toBeVisible({ timeout: 30_000 });

  // History: the hand edit is a change to words.ts; restoring the first version puts it back.
  await page.getByRole("button", { name: "Studio" }).click();
  const history = await openHistory(page, studio);
  await history.getByRole("button", { name: /edited the code by hand/ }).click();
  const change = history.getByRole("region", { name: /Changes in version/ });
  await expect(change).toContainText("words.ts");
  await expect(change.locator(".k-diff-add")).toContainText(["Second words, edited in the Studio."]);
  await history.getByRole("button", { name: /Added from a file/ }).click();
  await history.getByRole("button", { name: /^Restore v1$/ }).click();
  // The Studio closes the sheet once the version is back.
  await expect(history).toBeHidden({ timeout: 30_000 });

  await page.goto("/?user=two-files");
  await expect(page.getByText("First words, from the module.")).toBeVisible({ timeout: 30_000 });
});

test("files and folders are made in the Studio's code, imported by the app, saved, and a file is deleted", async ({ page }) => {
  await addAsMine(page, "two-files.potyro-app.zip", packTwoFiles());
  await page.getByRole("button", { name: "Studio" }).click();
  const studio = page.locator(".k-studio");
  const tools = await openSource(page, studio);
  const files = tools.getByRole("navigation", { name: "The app's files" });

  // A folder, then a file in it: the folder is the new file's place, and the editor opens on it.
  await files.getByRole("button", { name: "New folder" }).click();
  await files.getByRole("textbox", { name: "Name of the new folder" }).fill("lib");
  await files.getByRole("textbox", { name: "Name of the new folder" }).press("Enter");
  await files.getByRole("button", { name: "New file in lib" }).click();
  const name = files.getByRole("textbox", { name: "Name of the new file" });
  await name.fill("notes.md");
  await name.press("Enter");
  await expect(files.getByRole("alert")).toContainText(".ts");
  await name.fill("greet.ts");
  await name.press("Enter");
  const greet = tools.getByRole("textbox", { name: "lib/greet.ts" });
  await expect(greet).toBeVisible();
  await greet.fill('export const GREETING = "Made in a new file.";\n');
  if (process.env.SHOT) {
    await page.screenshot({ path: `${process.env.SHOT}-tree-wide.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.SHOT}-tree-phone.png` });
    await tools.getByRole("button", { name: /lib\/greet\.ts/ }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.SHOT}-tree-phone-open.png` });
    await page.setViewportSize({ width: 1280, height: 800 });
  }

  // The app imports it.
  await files.getByRole("button", { name: /^The app/ }).click();
  const app = tools.getByRole("textbox", { name: "App source" });
  await app.fill(APP.replace('import { EMPTY } from "./words.ts";', 'import { GREETING as EMPTY } from "./lib/greet.ts";'));
  await tools.getByRole("button", { name: "Save changes" }).click();
  await expect(files.getByRole("button", { name: /^greet\.ts/ })).not.toHaveAttribute("data-changed", "true", { timeout: 30_000 });
  await page.goto("/?user=two-files");
  await expect(page.getByText("Made in a new file.")).toBeVisible({ timeout: 30_000 });

  // words.ts is no longer imported: deleting it is a change Save keeps, and the app still opens.
  await page.getByRole("button", { name: "Studio" }).click();
  const again = await openSource(page, studio);
  const tree = again.getByRole("navigation", { name: "The app's files" });
  await tree.getByRole("button", { name: "words.ts", exact: true }).hover();
  await tree.getByRole("button", { name: "Delete words.ts" }).click();
  await page.getByRole("alertdialog", { name: /Delete words\.ts/ }).or(page.getByRole("dialog", { name: /Delete words\.ts/ })).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(tree.getByRole("button", { name: "words.ts", exact: true })).toHaveCount(0);
  await again.getByRole("button", { name: "Save changes" }).click();
  await expect
    .poll(async () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]").find((a: { id: string }) => a.id === "two-files")?.lock ?? {})), { timeout: 30_000 })
    .toEqual(["src/lib/greet.ts"]);
  await page.goto("/?user=two-files");
  await expect(page.getByText("Made in a new file.")).toBeVisible({ timeout: 30_000 });
});
