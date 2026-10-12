// A browser that used the app before the rename (#248) keeps its identity.
//
// The rename moved the vault's IndexedDB database from `karta-vault` to `potyro-vault`, and the
// names its secrets are filed under from `karta:` to `potyro:` — with no migration. The shell moved
// the plain localStorage keys, so such a device still had its id, but every secret was looked up in
// a new, empty vault: "This device's sign-in keys are missing", and no synced app would open.
//
// These seed a `karta-vault` exactly as the pre-rename build wrote it (its code, verbatim but for
// the export, is `preRenameVault` below), then run today's code against the same browser.

import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { browserVault, ensureIdentity, identityAccount, peekIdentity, recoveryPassphrase, secureIdentitySecrets, type IdentityKeys, type SecretVault } from "../src/index.js";

/** `packages/identity/src/vault.ts` `browserVault` as of ba43dc9^, the last build before the rename. */
function preRenameVault(g: typeof globalThis): SecretVault {
  const DB = "karta-vault";
  const STORE = "secrets";
  const KEY = "__key";
  const idb = g.indexedDB;
  const subtle = g.crypto.subtle;
  const request = <T>(r: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const openDb = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const open = idb.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  let ready: Promise<{ db: IDBDatabase; key: CryptoKey }> | null = null;
  const open = () =>
    (ready ??= (async () => {
      const db = await openDb();
      const existing = await request(db.transaction(STORE).objectStore(STORE).get(KEY));
      if (existing) return { db, key: existing as CryptoKey };
      const fresh = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await request(db.transaction(STORE, "readwrite").objectStore(STORE).add(fresh, KEY));
      return { db, key: fresh };
    })());
  return {
    available: async () => true,
    async get(k) {
      const v = await open();
      const sealed = (await request(v.db.transaction(STORE).objectStore(STORE).get(k))) as { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer } | undefined;
      if (!sealed) return null;
      return new TextDecoder().decode(await subtle.decrypt({ name: "AES-GCM", iv: sealed.iv }, v.key, sealed.data));
    },
    async set(k, value) {
      const v = await open();
      const iv = g.crypto.getRandomValues(new Uint8Array(12));
      const data = await subtle.encrypt({ name: "AES-GCM", iv }, v.key, new TextEncoder().encode(value));
      await request(v.db.transaction(STORE, "readwrite").objectStore(STORE).put({ iv, data }, k));
    },
    async remove(k) {
      const v = await open();
      await request(v.db.transaction(STORE, "readwrite").objectStore(STORE).delete(k));
    },
  };
}

/** A fresh browser profile: its own IndexedDB, the real WebCrypto. */
const browser = (): typeof globalThis => ({ indexedDB: new IDBFactory(), crypto: globalThis.crypto }) as unknown as typeof globalThis;

const plainKeys = (plain: Map<string, string>, secrets?: SecretVault): IdentityKeys => ({
  get: (k) => plain.get(k) ?? null,
  set: (k, v) => void plain.set(k, v),
  remove: (k) => void plain.delete(k),
  ...(secrets ? { secrets } : {}),
});

/** The pre-rename build's names: every `potyro:` key it is asked for, filed under `karta:`. */
const underOldNames = (plain: Map<string, string>, vault: SecretVault): IdentityKeys => {
  const old = (k: string) => k.replace(/^potyro:/, "karta:");
  return {
    get: (k) => plain.get(old(k)) ?? null,
    set: (k, v) => void plain.set(old(k), v),
    remove: (k) => void plain.delete(old(k)),
    secrets: { available: vault.available, get: (k) => vault.get(old(k)), set: (k, v) => vault.set(old(k), v), remove: (k) => vault.remove(old(k)) },
  };
};

/** What the shell's rename migration does to localStorage at boot (packages/shell/src/rename-migration.ts). */
function moveStorageKeys(plain: Map<string, string>): void {
  for (const [k, v] of [...plain]) {
    if (!k.startsWith("karta:")) continue;
    const target = "potyro:" + k.slice("karta:".length);
    if (!plain.has(target)) plain.set(target, v);
    plain.delete(k);
  }
}

/** Every entry of a database, as comparable text — bytes included, so a rewrite would show. */
async function dump(g: typeof globalThis, name: string): Promise<Record<string, string> | null> {
  const names = (await g.indexedDB.databases()).map((d) => d.name);
  if (!names.includes(name)) return null;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = g.indexedDB.open(name);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const store = db.transaction("secrets").objectStore("secrets");
  const [keys, values] = await Promise.all(
    [store.getAllKeys(), store.getAll()].map(
      (r) => new Promise<unknown[]>((resolve) => void (r.onsuccess = () => resolve(r.result as unknown[]))),
    ),
  );
  db.close();
  const text = (v: unknown): string => {
    if (v instanceof CryptoKey) return `CryptoKey(${v.algorithm.name},${v.extractable})`;
    if (v && typeof v === "object" && "iv" in v && "data" in v) {
      const s = v as { iv: Uint8Array; data: ArrayBuffer };
      return `${[...s.iv].join(",")}|${[...new Uint8Array(s.data)].join(",")}`;
    }
    return JSON.stringify(v);
  };
  return Object.fromEntries(keys!.map((k, i) => [String(k), text(values![i])]));
}

/** A device as the pre-rename build left it: id + name in localStorage, secrets sealed in `karta-vault`. */
async function preRenameDevice(): Promise<{ g: typeof globalThis; plain: Map<string, string>; id: string; secret: string; words: string }> {
  const g = browser();
  const plain = new Map<string, string>();
  const old = underOldNames(plain, preRenameVault(g));
  const { id } = await ensureIdentity(old);
  const { secret } = await identityAccount(old);
  const words = await recoveryPassphrase(old);
  expect([...plain.keys()].sort()).toEqual(["karta:identity:id", "karta:identity:name", "karta:identity:origin"]);
  return { g, plain, id, secret, words };
}

describe("a browser from before the rename", () => {
  it("still opens its synced apps: the secrets come across from karta-vault, under their new names", async () => {
    const { g, plain, id, secret, words } = await preRenameDevice();
    const before = await dump(g, "karta-vault");
    expect(Object.keys(before!).sort()).toEqual(["__key", "karta:identity:secret", "karta:identity:seed"]);

    // Today's build boots: localStorage moves first (main.tsx), then the identity is read.
    moveStorageKeys(plain);
    const keys = plainKeys(plain, browserVault(g)!);
    await secureIdentitySecrets(keys);

    expect(peekIdentity(keys)?.id).toBe(id);
    expect(await identityAccount(keys)).toEqual({ id, secret }); // no IdentityKeysMissingError
    expect(await recoveryPassphrase(keys)).toBe(words);
    expect(await dump(g, "karta-vault")).toEqual(before); // the old vault is left exactly as it was
    const moved = await dump(g, "potyro-vault");
    expect(Object.keys(moved!).filter((k) => !k.startsWith("__")).sort()).toEqual(["potyro:identity:secret", "potyro:identity:seed"]);
  });

  it("moves them once: a second boot reads the new vault and changes nothing", async () => {
    const { g, plain, id, secret } = await preRenameDevice();
    moveStorageKeys(plain);
    await secureIdentitySecrets(plainKeys(plain, browserVault(g)!));
    const first = { old: await dump(g, "karta-vault"), current: await dump(g, "potyro-vault") };

    const again = plainKeys(plain, browserVault(g)!); // a reload: a new vault object over the same browser
    expect(await identityAccount(again)).toEqual({ id, secret });
    expect({ old: await dump(g, "karta-vault"), current: await dump(g, "potyro-vault") }).toEqual(first);
  });

  it("never overwrites a secret the new vault already holds", async () => {
    const { g, plain } = await preRenameDevice();
    moveStorageKeys(plain);
    const current = browserVault(g)!;
    await current.set("potyro:identity:secret", "written-since-the-rename");

    expect(await browserVault(g)!.get("potyro:identity:secret")).toBe("written-since-the-rename");
  });

  it("brings across every secret it kept, not only the identity's (an Ask source's API key)", async () => {
    const g = browser();
    await preRenameVault(g).set("karta:source-key:mine:weather", "sk-123");
    expect(await browserVault(g)!.get("potyro:source-key:mine:weather")).toBe("sk-123");
  });

  it("does not create a karta-vault on a browser that never had one", async () => {
    const g = browser();
    const keys = plainKeys(new Map(), browserVault(g)!);
    await ensureIdentity(keys);
    expect((await g.indexedDB.databases()).map((d) => d.name)).toEqual(["potyro-vault"]);
  });

  it("finds an old vault without indexedDB.databases(), and still creates none", async () => {
    const { g, plain, id, secret } = await preRenameDevice();
    moveStorageKeys(plain);
    const idb = g.indexedDB;
    const noList = { indexedDB: { open: idb.open.bind(idb), deleteDatabase: idb.deleteDatabase.bind(idb), cmp: idb.cmp.bind(idb) }, crypto: g.crypto } as unknown as typeof globalThis;
    expect(await identityAccount(plainKeys(plain, browserVault(noList)!))).toEqual({ id, secret });

    const fresh = browser();
    const freshNoList = { indexedDB: { open: fresh.indexedDB.open.bind(fresh.indexedDB) }, crypto: fresh.crypto } as unknown as typeof globalThis;
    await ensureIdentity(plainKeys(new Map(), browserVault(freshNoList)!));
    expect((await fresh.indexedDB.databases()).map((d) => d.name)).toEqual(["potyro-vault"]);
  });
});

describe("a browser from before the vault AND the rename", () => {
  it("keeps the plain secrets the rename migration moved, and seals them", async () => {
    // No vault yet: everything, secrets too, was plain localStorage under `karta:`.
    const plain = new Map<string, string>();
    const old: IdentityKeys = {
      get: (k) => plain.get(k.replace(/^potyro:/, "karta:")) ?? null,
      set: (k, v) => void plain.set(k.replace(/^potyro:/, "karta:"), v),
    };
    const { id } = await ensureIdentity(old);
    const secret = plain.get("karta:identity:secret")!;
    expect(secret).toBeTruthy();

    moveStorageKeys(plain);
    const g = browser();
    const keys = plainKeys(plain, browserVault(g)!);
    await secureIdentitySecrets(keys);

    expect(await identityAccount(keys)).toEqual({ id, secret });
    expect(plain.has("potyro:identity:secret")).toBe(false); // sealed now, not left in the clear
    expect(await dump(g, "karta-vault")).toBeNull();
  });
});
