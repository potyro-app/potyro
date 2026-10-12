import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Libraries by URL (#266), in a real browser. esm.sh is never reached: every request to it is
// answered from e2e/fixtures/esm, and counted. The checks are what a person sees: the card names the
// fetch before it happens, the app shows what the library computed, it still does with esm.sh gone
// after install, and bytes changed behind the app's back are refused by the library's name.

const ROOT = "https://esm.sh/fancy-sum@1.2.3?bundle";
const SITE: Record<string, string> = {
  [ROOT]: "fancy-sum-root.mjs",
  "https://esm.sh/fancy-sum@1.2.3/es2022/fancy-sum.bundle.mjs": "fancy-sum.bundle.mjs",
  "https://esm.sh/tiny-twice@0.1.0/es2022/tiny-twice.mjs": "tiny-twice.mjs",
  "https://esm.sh/needs-window@1.0.0?bundle": "needs-window.mjs",
};
const fixture = (name: string) => readFileSync(new URL(`./fixtures/esm/${name}`, import.meta.url), "utf8");

/** Serve esm.sh from the fixtures, or refuse it outright; returns the URLs asked for. */
async function esmSh(page: Page, mode: "serve" | "blocked"): Promise<string[]> {
  const asked: string[] = [];
  await page.context().unroute("https://esm.sh/**");
  await page.context().route("https://esm.sh/**", (route) => {
    const url = route.request().url();
    asked.push(url);
    if (mode === "blocked" || !SITE[url]) return route.abort("internetdisconnected");
    return route.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: fixture(SITE[url]!) });
  });
  return asked;
}

const source = (library: string, use: string) => `import { defineApp } from "potyro";
import * as lib from "${library}";
export default defineApp({
  id: "summer",
  name: "Summer",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    sum: {
      label: "Sum",
      displayField: "title",
      fields: { title: { type: "text", required: true } },
      actions: {
        compute: async (_s, ctx) => {
          ctx.ui.toast(${use});
        },
      },
    },
  },
  pages: [
    { id: "all", title: "Sums", view: { type: "list", entity: "sum", display: { primary: "title" }, onOpen: { page: "one", param: { sumId: "id" } } } },
    { id: "one", title: "Sum", hidden: true, view: { type: "detail", entity: "sum", param: "sumId", actions: ["compute"] } },
  ],
});
`;
const SUMMER = source(ROOT, "lib.describe(12)");

const file = (name: string, text: string, mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.from(text) });
const SEED = file("seed.json", '{"sum":[{"title":"Twelve"}]}', "application/json");

async function addFromDevice(page: Page, files: ReturnType<typeof file>[]) {
  await page.getByRole("button", { name: "Add an app" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an app" });
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: /From this device/ }).click();
  await (await chooser).setFiles(files);
  await expect(dialog.getByRole("region", { name: /About / })).toBeVisible({ timeout: 30_000 });
  return dialog;
}

async function compute(page: Page): Promise<void> {
  await page.getByRole("listitem").filter({ hasText: "Twelve" }).first().click();
  await page.getByRole("button", { name: "Compute" }).click();
}

test.use({ viewport: { width: 1280, height: 800 } });

for (const mine of [false, true]) {
  const how = mine ? "as mine (trusted bundle)" : "sealed (isolate bundle)";
  test(`${how}: the card says what it fetches, the app shows what the library computed, and it works with esm.sh gone`, async ({ page }) => {
    const asked = await esmSh(page, "serve");
    await page.goto("/");
    const dialog = await addFromDevice(page, [file("summer.app.tsx", SUMMER), SEED]);

    // Said before anything is fetched: drawing the card asked esm.sh for nothing.
    const card = dialog.getByRole("region", { name: "About Summer" });
    await expect(card).toContainText("fetches fancy-sum 1.2.3 from esm.sh");
    await expect(card).toContainText("fetched once, when you add the app");
    expect(asked).toEqual([]);
    if (mine) await dialog.getByRole("checkbox", { name: /I wrote this/ }).check();
    await dialog.getByRole("button", { name: "Add app" }).click();

    await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", mine ? "trusted" : "untrusted", { timeout: 30_000 });
    // The whole graph, once: the ?bundle stub, the file it re-exports, and that file's dependency.
    expect([...asked].sort()).toEqual(Object.keys(SITE).filter((u) => !u.includes("needs-window")).sort());
    await compute(page);
    await expect(page.locator(".k-toast").last()).toHaveText("fancy-sum says 24");

    // esm.sh unreachable from here on. Reloaded, the app runs from the bytes it keeps.
    const after = await esmSh(page, "blocked");
    await page.reload();
    await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", mine ? "trusted" : "untrusted", { timeout: 30_000 });
    await compute(page);
    await expect(page.locator(".k-toast").last()).toHaveText("fancy-sum says 24");
    expect(after).toEqual([]);
  });
}

test("a library file changed behind the app's back is refused, by the library's name", async ({ page }) => {
  await esmSh(page, "serve");
  await page.goto("/");
  const dialog = await addFromDevice(page, [file("summer.app.tsx", SUMMER), SEED]);
  await dialog.getByRole("button", { name: "Add app" }).click();
  await expect(page.locator(".k-app")).toHaveAttribute("data-provenance", "untrusted", { timeout: 30_000 });
  const appId = await page.evaluate(() => new URLSearchParams(location.search).get("user"));
  expect(appId).toBe("summer");

  // Swap one byte of the library in the app's folder, the way a broken sync or a meddling tool could.
  await page.goto("/");
  await page.evaluate(async (id) => {
    const apps = JSON.parse(localStorage.getItem("potyro:user-apps") ?? "[]") as Array<{ id: string; lock?: Record<string, { file: string }> }>;
    const lock = apps.find((a) => a.id === id)!.lock!;
    const inner = Object.entries(lock).find(([url]) => url.includes("fancy-sum.bundle.mjs"))![1].file;
    const { openStore } = await import("/src/open-store.ts");
    const { writeLibraryFiles } = await import("/src/studio-libraries.ts");
    const store = await openStore(`user:${id}`);
    await writeLibraryFiles(store, [{ path: inner, data: new TextEncoder().encode('export const describe = () => "tampered";\n') }]);
  }, appId);

  await page.goto(`/?user=${appId}`);
  const splash = page.getByRole("alert");
  await expect(splash).toContainText("It could not open.", { timeout: 30_000 });
  await expect(splash).toContainText("fancy-sum 1.2.3 is not the copy this app was installed with, so it was not run.");
  await expect(page.locator(".k-app")).toHaveCount(0);
});

test("a library that needs a web page fails in the sealed box with a message naming it", async ({ page }) => {
  await esmSh(page, "serve");
  await page.goto("/");
  const dialog = await addFromDevice(page, [file("summer.app.tsx", source("https://esm.sh/needs-window@1.0.0?bundle", "String(lib.width)")), SEED]);
  const card = dialog.getByRole("region", { name: "About Summer" });
  await expect(card).toContainText("fetches needs-window 1.0.0 from esm.sh");
  await expect(card).toContainText("Some libraries only work in an app that runs as yours");
  await dialog.getByRole("button", { name: "Add app" }).click();

  const splash = page.getByRole("alert");
  await expect(splash).toContainText("needs-window 1.0.0 needs a full web page to work", { timeout: 30_000 });
  await expect(splash).toContainText("can only run as yours");
});
