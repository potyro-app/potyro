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
  const files = tools.getByRole("group", { name: "The app's files" });
  await expect(files.getByRole("button", { name: "The app" })).toHaveAttribute("aria-pressed", "true");
  await files.getByRole("button", { name: "words.ts" }).click();
  const words = tools.getByRole("textbox", { name: "words.ts" });
  await expect(words).toContainText("First words, from the module.");
  await words.fill(WORDS_V2);
  await expect(files.getByRole("button", { name: /words\.ts/ })).toHaveAttribute("data-changed", "true");
  if (process.env.SHOT) {
    await page.screenshot({ path: `${process.env.SHOT}-wide.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.SHOT}-phone.png` });
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await tools.getByRole("button", { name: "Save changes" }).click();
  await expect(files.getByRole("button", { name: /words\.ts/ })).not.toHaveAttribute("data-changed", "true", { timeout: 30_000 });

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
