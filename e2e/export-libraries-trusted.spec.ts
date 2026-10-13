import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// An export bundle carries the app's libraries and its own modules (#282), so a backup restores on a
// device with no network at all. The app is added from a file with esm.sh answered from
// e2e/fixtures/esm, exported, and added from that bundle in a fresh browser where every request off
// this machine is refused — and counted. What a person sees is the check: the card says the library
// came with the app, the app opens and its list draws what the library computed, and a bundle whose
// library was changed after export is refused by the library's name.

// The zip format the bundle is written in, to change one file of it the way a meddling tool could.
const { unzipSync, zipSync } = createRequire(new URL("../packages/store/package.json", import.meta.url))("fflate") as typeof import("fflate");

const ROOT = "https://esm.sh/fancy-sum@1.2.3?bundle";
const SITE: Record<string, string> = {
  [ROOT]: "fancy-sum-root.mjs",
  "https://esm.sh/fancy-sum@1.2.3/es2022/fancy-sum.bundle.mjs": "fancy-sum.bundle.mjs",
  "https://esm.sh/tiny-twice@0.1.0/es2022/tiny-twice.mjs": "tiny-twice.mjs",
};
const fixture = (name: string) => readFileSync(new URL(`./fixtures/esm/${name}`, import.meta.url), "utf8");

// The list's second line is the library's: "fancy-sum says 24" for twelve. Its own module (`./label`)
// is what names the row, so both kinds of code the bundle carries are drawn.
const SUMMER = `import { defineApp } from "potyro";
import { describe } from "${ROOT}";
import { label } from "./label.ts";
export default defineApp({
  id: "summer",
  name: "Summer",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    sum: {
      label: "Sum",
      displayField: "title",
      fields: { title: { type: "text", required: true }, n: { type: "number" } },
    },
  },
  pages: [
    { id: "all", title: "Sums", view: { type: "list", entity: "sum", display: { primary: (s) => label(s.title), secondary: (s) => describe(s.n) } } },
  ],
});
`;
const LABEL = "export const label = (t: string) => `Sum: ${t}`;\n";

const file = (name: string, text: string, mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.from(text) });

/** Serve esm.sh from the fixtures; returns the URLs asked for. */
async function esmSh(context: BrowserContext): Promise<string[]> {
  const asked: string[] = [];
  await context.route("https://esm.sh/**", (route) => {
    const url = route.request().url();
    asked.push(url);
    if (!SITE[url]) return route.abort("internetdisconnected");
    return route.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: fixture(SITE[url]!) });
  });
  return asked;
}

/** No network beyond this machine: every request elsewhere is refused, and recorded. */
async function offline(context: BrowserContext): Promise<string[]> {
  const asked: string[] = [];
  await context.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => {
      asked.push(route.request().url());
      return route.abort("internetdisconnected");
    },
  );
  return asked;
}

/** The <a download> and <input type=file> fallbacks, which headless Chromium can capture. */
async function plainFilePickers(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  });
}

async function addFromDevice(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles(files);
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  return dialog;
}

/** Make Summer with one record, from its files, and export it. Returns the bundle's bytes. */
async function exportedSummer(page: Page): Promise<Buffer> {
  await esmSh(page.context());
  await plainFilePickers(page.context());
  await page.goto("/");
  const dialog = await addFromDevice(page, [file("summer.app.tsx", SUMMER), file("label.ts", LABEL), file("seed.json", '{"sum":[{"title":"Twelve","n":12}]}', "application/json")]);
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  await expect(page.locator(".k-list-row", { hasText: "Sum: Twelve" })).toContainText("fancy-sum says 24", { timeout: 30_000 });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  return readFileSync(await (await download).path());
}

test.use({ viewport: { width: 1280, height: 800 } });

test("a bundle restores an app with a library on a device with no network: it opens and draws what the library computed", async ({ page, browser }) => {
  const bundle = await exportedSummer(page);

  const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const asked = await offline(other);
    await plainFilePickers(other);
    const theirs = await other.newPage();
    await theirs.goto("/");

    // The card says it fetches nothing: the library came in the bundle.
    const dialog = await addFromDevice(theirs, [{ name: "summer.potyro.zip", mimeType: "application/zip", buffer: bundle }]);
    const card = dialog.getByRole("region", { name: "About Summer" });
    await expect(card).toContainText("fancy-sum 1.2.3");
    await expect(card).toContainText("came with the app");
    await expect(card).not.toContainText("fetches");
    await dialog.getByRole("button", { name: "Add app" }).click();
    await expect(theirs.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });

    // Its records come back through Import, and the list draws them with the library and the module.
    const chooser = theirs.waitForEvent("filechooser");
    await theirs.getByRole("button", { name: "Import" }).click();
    await (await chooser).setFiles({ name: "summer.potyro.zip", mimeType: "application/zip", buffer: bundle });
    await theirs.waitForURL(/\?user=summer/, { waitUntil: "load" });
    await expect(theirs.locator(".k-toast")).toContainText("Imported data into Summer", { timeout: 30_000 });
    await expect(theirs.locator(".k-list-row", { hasText: "Sum: Twelve" })).toContainText("fancy-sum says 24");

    // Nothing left this machine, from the card to the drawn list.
    expect(asked).toEqual([]);
  } finally {
    await other.close();
  }
});

test("a bundle whose library was changed after export is refused, by the library's name", async ({ page, browser }) => {
  const bundle = await exportedSummer(page);
  const files = unzipSync(new Uint8Array(bundle));
  const lock = JSON.parse(new TextDecoder().decode(files["lock.json"])) as Record<string, { file: string }>;
  const inner = lock["https://esm.sh/fancy-sum@1.2.3/es2022/fancy-sum.bundle.mjs"]!.file;
  expect(files[`files/${inner}`]).toBeDefined();
  files[`files/${inner}`] = new TextEncoder().encode('export const describe = () => "tampered";\n');
  const tampered = Buffer.from(zipSync(files));

  const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const asked = await offline(other);
    const theirs = await other.newPage();
    await theirs.goto("/");
    const dialog = await addFromDevice(theirs, [{ name: "summer.potyro.zip", mimeType: "application/zip", buffer: tampered }]);
    await expect(dialog.getByRole("alert")).toContainText("fancy-sum 1.2.3 is not the copy this app was saved with, so it was not added.");
    await expect(dialog.getByRole("button", { name: "Add app" })).toBeDisabled();
    expect(asked).toEqual([]);
    await theirs.goto("/?user=summer");
    await expect(theirs.locator(".k-app")).toHaveCount(0);
  } finally {
    await other.close();
  }
});
