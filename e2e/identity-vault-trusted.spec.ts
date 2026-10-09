import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { ensureIdentity, recoveryPassphrase, type IdentityKeys } from "../packages/identity/src/index.js";

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
            const keys = (all.result as string[]).filter((k) => k !== "__key");
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
