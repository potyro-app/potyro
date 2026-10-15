import { test, expect, type BrowserContext, type Page } from "./console-guard";
import { ensureIdentity, recoveryPassphrase, type IdentityKeys } from "../packages/identity/src/index.js";
import { tileAction } from "./launcher-actions.js";

// The identity's secrets are not in plain site storage (#57).
//
// The seed and agent secret ARE the identity — whoever holds them signs as you in every space. They
// used to sit in localStorage. Now they live in IndexedDB, encrypted under a WebCrypto key the
// browser generated as non-extractable. Only a real browser has that IndexedDB and that key, which is
// why this is a browser spec: the unit tests cover the rules, this covers the vault that ships.

const STARTER = `import { defineApp } from "potyro";
export default defineApp({
  id: "who", name: "Who", version: "1.0.0", schemaVersion: 1,
  entities: { note: { label: "Note", icon: "📝", displayField: "title", fields: { title: { type: "text", required: true } } } },
  pages: [{ id: "all", title: "Notes", view: { type: "list", entity: "note", display: { primary: "title" } } }],
});
`;

const SECRET_KEYS = ["potyro:identity:seed", "potyro:identity:secret"];

async function device(context: BrowserContext, plain?: Record<string, string>): Promise<Page> {
  await context.addInitScript(
    ([source, legacy]) => {
      if (localStorage.getItem("potyro:user-apps")) return; // first load only
      localStorage.setItem("potyro:user-apps", JSON.stringify([{ id: "who", name: "Who", source, trusted: true, updatedAt: new Date().toISOString() }]));
      for (const [k, v] of Object.entries(legacy ?? {})) localStorage.setItem(k, v);
    },
    [STARTER, plain ?? null] as const,
  );
  return context.newPage();
}

const plainSecrets = (page: Page) =>
  page.evaluate((keys) => keys.filter((k) => localStorage.getItem(k) !== null), SECRET_KEYS).catch(() => ["(navigating)"]);

/** What the vault database holds, as a page script can see it: sealed bytes, never the secret. */
const vaultContents = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ keys: string[]; keyIsCryptoKey: boolean; extractable: boolean | null; sealed: string[] }>((resolve, reject) => {
        const open = indexedDB.open("potyro-vault");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction("secrets").objectStore("secrets");
          const all = store.getAllKeys();
          all.onsuccess = () => {
            const keys = (all.result as string[]).filter((k) => !k.startsWith("__")); // the key, and the vault's own bookkeeping
            const key = store.get("__key");
            key.onsuccess = () => {
              const k = key.result as CryptoKey | undefined;
              const values = store.getAll();
              values.onsuccess = () =>
                resolve({
                  keys,
                  keyIsCryptoKey: k instanceof CryptoKey,
                  extractable: k ? k.extractable : null,
                  sealed: (values.result as unknown[]).filter((v) => !(v instanceof CryptoKey)).map((v) => JSON.stringify(v)),
                });
            };
          };
        };
      }),
  );

const openYou = async (page: Page) => {
  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await page.getByRole("button", { name: "You and your devices" }).click();
  await page.getByRole("button", { name: /Add a device/ }).click();
  return (await page.locator(".k-passphrase").innerText({ timeout: 30_000 })).trim();
};

test("a new device keeps its identity secrets in the encrypted vault, and they survive a reload", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  const page = await device(ctx);
  await page.goto("/?user=who");
  await expect(page.locator("h1").first()).toHaveText("Who", { timeout: 30_000 });
  const words = await openYou(page);
  expect(words.split(/\s+/)).toHaveLength(24);

  expect(await plainSecrets(page)).toEqual([]);
  const vault = await vaultContents(page);
  expect(vault.keys.sort()).toEqual([...SECRET_KEYS].sort());
  expect(vault.keyIsCryptoKey).toBe(true);
  expect(vault.extractable).toBe(false); // no script can read the key's bytes back out
  // Sealed: neither the words' seed nor the secret appears in what is stored.
  const secretLike = /sealerSecret_|signerSecret_/;
  expect(vault.sealed.some((v) => secretLike.test(v))).toBe(false);

  const id = await page.evaluate(() => localStorage.getItem("potyro:identity:id"));
  await page.reload();
  await expect(page.locator("h1").first()).toHaveText("Who", { timeout: 30_000 });
  expect(await openYou(page)).toBe(words);
  expect(await page.evaluate(() => localStorage.getItem("potyro:identity:id"))).toBe(id);
  await ctx.close();
});

test("a device from before the vault has its plain secrets moved in — and is still the same person", async ({ browser }) => {
  test.slow();
  // An identity exactly as an older build left it: everything in plain localStorage.
  const plain = new Map<string, string>();
  const keys: IdentityKeys = { get: (k) => plain.get(k) ?? null, set: (k, v) => void plain.set(k, v) };
  const me = await ensureIdentity(keys);
  const expectedWords = await recoveryPassphrase(keys);

  const ctx = await browser.newContext();
  const page = await device(ctx, Object.fromEntries(plain));
  await page.goto("/?user=who");
  await expect(page.locator("h1").first()).toHaveText("Who", { timeout: 30_000 });

  // Boot moves them; the plain copies go only once the vault holds them.
  await expect.poll(() => plainSecrets(page), { timeout: 30_000 }).toEqual([]);
  expect((await vaultContents(page)).keys.sort()).toEqual([...SECRET_KEYS].sort());

  // Same person, same words: nothing was lost in the move.
  expect(await page.evaluate(() => localStorage.getItem("potyro:identity:id"))).toBe(me.id);
  expect(await openYou(page)).toBe(expectedWords);
  await ctx.close();
});

// ---- a browser that used the app before the rename (#248) ----
//
// The rename changed three names on disk and moved none of them: the vault database (`karta-vault`
// → `potyro-vault`, with its entries filed under `karta:`), the OPFS directory every database lives
// in (`/karta` → `/potyro`), and the localStorage prefix — the only one the shell migrates. On such a
// browser a synced app failed to boot ("This device's sign-in keys are missing") and every local app
// opened empty.
//
// The profile is built by today's build and then turned, name by name, into exactly what the build
// before the rename would have left: no fixture of the old code is needed, because the old code
// differed from today's in nothing BUT those names.

const LOCAL = STARTER.replace(/"who"/g, '"jot"').replace('"Who"', '"Jot"');

/** Every name the rename changed, put back the way the old build wrote them. Run on a page of this
 *  origin that is not the app, so nothing holds the databases open. */
const asBeforeTheRename = (page: Page) =>
  page.evaluate(async () => {
    // The files first: the one step that can fail while the app's worker is still letting go, and
    // safe to repeat.
    const root = await navigator.storage.getDirectory();
    const copy = async (from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle): Promise<void> => {
      for await (const [name, h] of (from as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (h.kind === "directory") {
          await copy(h as FileSystemDirectoryHandle, await to.getDirectoryHandle(name, { create: true }));
        } else {
          const w = await (await to.getFileHandle(name, { create: true })).createWritable();
          await w.write(await (await (h as FileSystemFileHandle).getFile()).arrayBuffer());
          await w.close();
        }
      }
    };
    await copy(await root.getDirectoryHandle("potyro"), await root.getDirectoryHandle("karta", { create: true }));
    await root.removeEntry("potyro", { recursive: true });

    const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
    const open = (name: string, init?: (db: IDBDatabase) => void) =>
      new Promise<IDBDatabase>((res, rej) => {
        const o = indexedDB.open(name, 1);
        o.onupgradeneeded = () => init?.(o.result);
        o.onsuccess = () => res(o.result);
        o.onerror = () => rej(o.error);
      });
    const current = await open("potyro-vault");
    const store = current.transaction("secrets").objectStore("secrets");
    const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
    current.close();
    const old = await open("karta-vault", (db) => db.createObjectStore("secrets"));
    const tx = old.transaction("secrets", "readwrite");
    keys.forEach((k, i) => {
      const name = String(k);
      if (name.startsWith("__migrated")) return;
      tx.objectStore("secrets").put(values[i], name.replace(/^potyro:/, "karta:")); // the CryptoKey clones as itself
    });
    await new Promise((res) => (tx.oncomplete = res));
    old.close();
    await req(indexedDB.deleteDatabase("potyro-vault") as unknown as IDBRequest<unknown>);

    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("potyro:")) continue;
      localStorage.setItem("karta:" + k.slice("potyro:".length), localStorage.getItem(k)!);
      localStorage.removeItem(k);
    }
  });

/** The names and sealed bytes in `karta-vault`, to show it is only ever read. */
const oldVault = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const o = indexedDB.open("karta-vault");
        o.onsuccess = () => {
          const s = o.result.transaction("secrets").objectStore("secrets");
          const r = s.getAllKeys();
          r.onsuccess = () => resolve((r.result as string[]).sort());
        };
      }),
  );

test("a browser from before the rename opens its synced and local apps, with their data and the same identity", async ({ browser }) => {
  test.slow();
  const ctx = await browser.newContext();
  await ctx.addInitScript(
    ([who, jot]) => {
      if (localStorage.getItem("potyro:user-apps") || localStorage.getItem("karta:user-apps")) return;
      const now = new Date().toISOString();
      localStorage.setItem(
        "potyro:user-apps",
        JSON.stringify([
          { id: "who", name: "Who", source: who, trusted: true, updatedAt: now },
          { id: "jot", name: "Jot", source: jot, trusted: true, updatedAt: now },
        ]),
      );
    },
    [STARTER, LOCAL] as const,
  );
  const page = await ctx.newPage();
  const add = async (title: string) => {
    await page.getByRole("button", { name: /Add: Note|Add Note/i }).first().click();
    await page.getByLabel(/title/i).fill(title);
    await page.getByRole("button", { name: /^(Save|Create)$/i }).first().click();
    await expect(page.locator(".k-list-row", { hasText: title })).toBeVisible();
  };

  // A local app with a note, and a synced app with a note — the synced one in the device's CRDT
  // database, its keys in the vault.
  await page.goto("/?user=jot");
  await expect(page.locator("h1").first()).toHaveText("Jot", { timeout: 30_000 });
  await add("Kept locally");
  await page.goto("/?user=who");
  await expect(page.locator("h1").first()).toHaveText("Who", { timeout: 30_000 });
  await add("Kept in sync");
  await page.getByRole("button", { name: /switch app|launcher|apps/i }).first().click();
  await tileAction(page, "Who", "sync");
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".k-dialog")).toContainText("Moved 1 record", { timeout: 30_000 });
  await page.locator(".k-dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".k-dialog")).toContainText("more than one place", { timeout: 30_000 });
  await page.locator(".k-dialog").getByRole("button", { name: "Cancel" }).click();
  await page.goto("/?user=who");
  await expect(page.locator(".k-sync-status")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".k-list-row", { hasText: "Kept in sync" })).toBeVisible({ timeout: 30_000 });
  const id = await page.evaluate(() => localStorage.getItem("potyro:identity:id"));
  const words = await openYou(page);

  // Away from the app, so its worker lets go of the files; then back to the old names.
  await page.goto("/manifest.webmanifest");
  await expect.poll(() => asBeforeTheRename(page).then(() => "done", (e: Error) => e.message), { timeout: 30_000 }).toBe("done");
  const before = await oldVault(page);
  expect(before).toEqual(["__key", "karta:identity:secret", "karta:identity:seed"]);

  // The renamed build, on that browser.
  await page.goto("/?user=who");
  await expect(page.locator("h1").first()).toHaveText("Who", { timeout: 30_000 });
  await expect(page.locator("body")).not.toContainText("Boot error");
  await expect(page.locator(".k-sync-status")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".k-list-row", { hasText: "Kept in sync" })).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => localStorage.getItem("potyro:identity:id"))).toBe(id);
  expect(await openYou(page)).toBe(words);

  await page.goto("/?user=jot");
  await expect(page.locator("h1").first()).toHaveText("Jot", { timeout: 30_000 });
  await expect(page.locator(".k-list-row", { hasText: "Kept locally" })).toBeVisible({ timeout: 30_000 });

  // The old vault is a fallback, only ever read.
  expect(await oldVault(page)).toEqual(before);
  await ctx.close();
});
