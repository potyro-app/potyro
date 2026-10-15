import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// An app is never "working" without the files it shipped with.
//
// The bug (2026-10-15, apps.vaz.io): Breakout, added from its package in one tab, worked there; in a
// second tab it said "No file "levels.json" in this app". The first tab held the app's database, so
// the second could not open it — and opened a fresh, empty localStorage store in its place, without
// a word. The app then ran on that store: no records, no files. Now the second tab says its data is
// open in the other tab and offers Try again; an app whose shipped file is missing says so before
// any of its code runs, and puts it back from the link it came from.

const PACK = fileURLToPath(new URL("../scripts/pack-app.mjs", import.meta.url));
const BREAKOUT = fileURLToPath(new URL("../apps/breakout", import.meta.url));

/** Pack these files (copied out of `from`) into a package, in a scratch folder. */
function pack(from: string, files: string[]): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "shipped-"));
  for (const f of files) copyFileSync(join(from, f), join(dir, f));
  execFileSync("node", [PACK, ...files, "-o", "out.zip"], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, stdio: "pipe" });
  return readFileSync(join(dir, "out.zip"));
}

async function addPackage(page: Page, name: string, zip: Buffer, mine: boolean): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles([{ name: `${name}.potyro-app.zip`, mimeType: "application/zip", buffer: zip }]);
  await expect(dialog.getByRole("region", { name: new RegExp(`About ${name}`, "i") })).toBeVisible({ timeout: 30_000 });
  if (mine) await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", mine ? "trusted" : "untrusted", { timeout: 30_000 });
}

test.use({ viewport: { width: 1280, height: 800 } });

test("Breakout open in one tab: a second tab says its data is open there, never opens an empty stand-in, and Try again opens it once the first is closed", async ({ context }) => {
  const a = await context.newPage();
  await addPackage(a, "Breakout", pack(BREAKOUT, ["breakout.app.ts", "levels.json"]), true);

  const b = await context.newPage();
  const fellBack: string[] = [];
  b.on("console", (m) => {
    if (/Using local storage for "user:breakout"/.test(m.text())) fellBack.push(m.text());
  });
  await b.goto("/?user=breakout");
  const splash = b.getByRole("alert");
  await expect(splash).toContainText("It could not open.", { timeout: 30_000 });
  await expect(splash).toContainText("open in another Potyro tab or window");
  await expect(splash).not.toContainText("No file");
  expect(fellBack).toEqual([]);

  await a.close();
  await b.getByRole("button", { name: "Try again" }).click();
  await expect(b.locator(".k-app")).toHaveAttribute("data-provenance", "trusted", { timeout: 30_000 });
  await expect(b.getByRole("alert")).toHaveCount(0);
  // Its shipped file is in its folder, on its own store.
  await b.goto("/?data=breakout&files");
  await expect(b.getByText("levels.json").first()).toBeVisible({ timeout: 30_000 });
});

const READER = (extra: string) => `import { defineApp } from "potyro";
export default defineApp({
  id: "reader",
  name: "Reader",
  version: "1.0.0",
  schemaVersion: 1,
  entities: { note: { label: "Note", displayField: "text", fields: { text: { type: "text" } } } },
  pages: [{
    id: "all",
    title: "Notes",
    actions: [{ label: "Read it", run: async (ctx) => ctx.ui.toast(String((await ctx.files.json("${extra}"))?.word)) }],
    view: { type: "list", entity: "note", display: { primary: "text" } },
  }],
});
`;

for (const sealed of [false, true]) {
  test(`a missing shipped file is named before the app runs, and comes back from its link (${sealed ? "sealed" : "as yours"})`, async ({ page }) => {
    const dir = mkdtempSync(join(tmpdir(), "shipped-"));
    writeFileSync(join(dir, "reader.app.ts"), READER("data.v2.json"));
    writeFileSync(join(dir, "data.v2.json"), '{"word":"hello"}');
    const zip = pack(dir, ["reader.app.ts", "data.v2.json"]);
    const link = "https://apps.example.test/reader.potyro-app.zip";
    await page.context().route(link, (route) => route.fulfill({ status: 200, contentType: "application/zip", headers: { "access-control-allow-origin": "*" }, body: zip }));

    await page.goto(`/#add=${encodeURIComponent(link)}`);
    const dialog = page.getByRole("dialog", { name: "Add an app" });
    await dialog.getByRole("button", { name: "Fetch" }).click();
    await expect(dialog.getByRole("region", { name: "About Reader" })).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Add app" }).click();
    await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
    if (!sealed) {
      await page.evaluate(() => {
        const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<{ id: string; trusted?: boolean }>;
        localStorage.setItem("potyro:user-apps", JSON.stringify(apps.map((x) => (x.id === "reader" ? { ...x, trusted: true } : x))));
      });
    }
    await page.locator(".k-page-action", { hasText: "Read it" }).click();
    await expect(page.locator(".k-toast").last()).toHaveText("hello");

    // The file goes missing — deleted from its folder here, as it was missing when another store
    // stood in for the app's own.
    await page.goto("/?data=reader&files");
    await page.getByRole("button", { name: "More for data.v2.json" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: "More for data.v2.json" })).toHaveCount(0);

    await page.goto("/?user=reader");
    const splash = page.getByRole("alert");
    await expect(splash).toContainText("The file it came with, data.v2.json, is not on this device", { timeout: 30_000 });
    await splash.getByRole("button", { name: "Reinstall its files" }).click();
    await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", sealed ? "untrusted" : "trusted", { timeout: 30_000 });
    await page.locator(".k-page-action", { hasText: "Read it" }).click();
    await expect(page.locator(".k-toast").last()).toHaveText("hello");
  });
}
