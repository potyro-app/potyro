import { test, expect, type Page, type BrowserContext } from "./console-guard";

// One tab owns the storage (packages/store/src/storage-owner.ts).
//
// Every app's database lives in one OPFS pool, and only one tab at a time can hold its files. With
// apps.vaz.io open in two tabs, the second tab's worker asked for the same files, got one
// `NoModificationAllowedError` per file and then `removeVfs() failed with no recovery strategy` —
// sqlite-wasm trying to delete the pool's directory — and carried on over a second copy of the apps
// in localStorage, so what was written in one tab was missing from the other. Seen in Firefox first;
// Chromium does exactly the same. These run in every engine that has the projects for it
// (`POTYRO_STORAGE_BROWSERS=1 pnpm e2e --project=storage-firefox --project=storage-webkit`).

/** Every console error and page error in the context, from every tab, as text. */
function errorsOf(ctx: BrowserContext): string[] {
  const errors: string[] = [];
  const watch = (page: Page) => {
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
  };
  ctx.pages().forEach(watch);
  ctx.on("page", watch);
  return errors;
}

const elsewhere = (page: Page) => page.getByRole("alertdialog", { name: "Potyro is open in another tab" });

async function openGroceries(page: Page): Promise<void> {
  await page.goto("/?user=groceries");
  await expect(page.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
}

async function addItem(page: Page, name: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "Add an item" });
  await input.fill(name);
  await input.press("Enter");
  await expect(page.getByRole("checkbox", { name })).toBeVisible();
}

test.use({ viewport: { width: 1280, height: 860 } });

test("a second tab says Potyro is open elsewhere instead of fighting for the files", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  const errors = errorsOf(ctx);
  const first = await ctx.newPage();
  await openGroceries(first);
  await addItem(first, "Written in the first tab");

  const second = await ctx.newPage();
  await second.goto("/?user=groceries");
  await expect(elsewhere(second)).toBeVisible({ timeout: 30_000 });
  await expect(elsewhere(second).getByRole("button", { name: "Use it here" })).toBeFocused();
  // The first tab carries on as it was.
  await expect(elsewhere(first)).toHaveCount(0);
  await addItem(first, "Still the first tab");

  expect(errors).toEqual([]);
  await ctx.close();
});

test("Use it here moves Potyro to this tab, and the data is right in both", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  const errors = errorsOf(ctx);
  const first = await ctx.newPage();
  await openGroceries(first);
  await addItem(first, "From the first tab");

  const second = await ctx.newPage();
  await second.goto("/?user=groceries");
  await elsewhere(second).getByRole("button", { name: "Use it here" }).click();

  // The second tab has the apps, with what the first one wrote; the first one steps aside.
  await expect(second.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await expect(second.getByRole("checkbox", { name: "From the first tab" })).toBeVisible();
  await expect(elsewhere(first)).toBeVisible({ timeout: 15_000 });
  await addItem(second, "From the second tab");

  // And back: everything either tab wrote is there.
  await elsewhere(first).getByRole("button", { name: "Use it here" }).click();
  await expect(first.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await expect(first.getByRole("checkbox", { name: "From the first tab" })).toBeVisible();
  await expect(first.getByRole("checkbox", { name: "From the second tab" })).toBeVisible();
  await expect(elsewhere(second)).toBeVisible({ timeout: 15_000 });

  expect(errors).toEqual([]);
  await ctx.close();
});

test("closing the tab that has Potyro lets the next one open normally", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  const errors = errorsOf(ctx);
  const first = await ctx.newPage();
  await openGroceries(first);
  await addItem(first, "Before closing");
  await first.close();

  const second = await ctx.newPage();
  await openGroceries(second);
  await expect(second.getByRole("checkbox", { name: "Before closing" })).toBeVisible();
  // A reload is the same tab coming back: it must not find itself in the way.
  await second.reload();
  await expect(second.locator("h1").first()).toHaveText("Groceries", { timeout: 30_000 });
  await expect(elsewhere(second)).toHaveCount(0);

  expect(errors).toEqual([]);
  await ctx.close();
});

// A browser that used Potyro before the rename (#248) has its databases in `/karta` as well
// (#274): the worker installs a second pool there. Both pools are covered by the one owner, and the
// second tab must not touch either.
test("with databases from before the rename, a second tab leaves both pools alone", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  const errors = errorsOf(ctx);
  const page = await ctx.newPage();
  await openGroceries(page);
  await addItem(page, "Kept from before the rename");

  // Away from the app so its worker lets go of the files, then the pool moved back to `/karta`. An
  // image, because Firefox downloads the manifest instead of showing it.
  await page.goto("/icon-192.png");
  const moved = () =>
    page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const copy = async (from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle): Promise<void> => {
        for await (const [name, h] of (from as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
          if (h.kind === "directory") await copy(h as FileSystemDirectoryHandle, await to.getDirectoryHandle(name, { create: true }));
          else {
            const w = await (await to.getFileHandle(name, { create: true })).createWritable();
            await w.write(await (await (h as FileSystemFileHandle).getFile()).arrayBuffer());
            await w.close();
          }
        }
      };
      await copy(await root.getDirectoryHandle("potyro"), await root.getDirectoryHandle("karta", { create: true }));
      await root.removeEntry("potyro", { recursive: true });
    });
  const opfs = await page.evaluate(() => typeof navigator.storage?.getDirectory === "function");
  test.skip(!opfs, "this engine has no OPFS here, so there is no pool to move");
  await expect.poll(() => moved().then(() => "done", (e: Error) => e.message), { timeout: 30_000 }).toBe("done");

  await openGroceries(page);
  await expect(page.getByRole("checkbox", { name: "Kept from before the rename" })).toBeVisible();
  const second = await ctx.newPage();
  await second.goto("/?user=groceries");
  await expect(elsewhere(second)).toBeVisible({ timeout: 30_000 });
  // The first tab still has its data, and its files: nothing was deleted by the second.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Kept from before the rename" })).toBeVisible({ timeout: 30_000 });

  expect(errors).toEqual([]);
  await ctx.close();
});
