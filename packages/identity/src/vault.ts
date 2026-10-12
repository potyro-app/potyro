// Where the identity's SECRETS live (KA-16 acceptance: "secure local storage", #57).
//
// The account id and display name are not secret — every person you share with sees them — and
// they stay where they were, because `peekIdentity` must answer synchronously. The seed and the
// agent secret are the whole identity: whoever holds them can sign as you in every space you are in.
// They used to sit in plain localStorage, readable by anything that can read site storage — a
// browser extension, a backup or sync tool, someone copying storage out of devtools.
//
// So they go through a `SecretVault`:
//
//   Android / iOS   the platform keystore, via the native package (`maybeCreateNativeVault`)
//   browser         IndexedDB, encrypted with an AES-GCM key the browser generated as NON-EXTRACTABLE
//                   — the raw key bytes cannot be read back out by any script, ours included
//
// Honest about the limit on the web: code running on this origin can still ASK the key to decrypt.
// Nothing in a browser prevents that; what this removes is the secret lying around in the clear. The
// hardware-backed half is the native vault.
//
// And unavailable is not fatal: a browser without IndexedDB or WebCrypto (some private modes) keeps
// working exactly as before, in localStorage, rather than leaving someone without an identity.

export interface SecretVault {
  /** Can this vault be used here? Checked before every use; a `false` means "use plain storage". */
  available(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** An in-memory vault — for tests, and for anywhere a real one is not wanted. */
export function memoryVault(): SecretVault & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    available: async () => true,
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    remove: async (k) => void map.delete(k),
  };
}

/**
 * A vault whose real implementation is decided later — so the composition root can register it
 * synchronously, before anything reads identity, even though finding out whether this is a native
 * device is asynchronous.
 */
export function deferredVault(choose: () => Promise<SecretVault | null | undefined>): SecretVault {
  let chosen: Promise<SecretVault | null> | null = null;
  const vault = (): Promise<SecretVault | null> => (chosen ??= choose().then((v) => v ?? null).catch(() => null));
  return {
    available: async () => {
      const v = await vault();
      return v ? v.available() : false;
    },
    get: async (k) => (await vault())?.get(k) ?? null,
    set: async (k, v) => {
      const target = await vault();
      if (!target) throw new Error("No secret vault on this device.");
      await target.set(k, v);
    },
    remove: async (k) => void (await (await vault())?.remove(k)),
  };
}

const DB = "potyro-vault";
const STORE = "secrets";
const KEY = "__key";

interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/**
 * Where this vault lived before the rename (#248), and the prefix its entries were filed under.
 *
 * The rename moved the database and the key names together and migrated neither, so a browser that
 * had used the app before it came up with its id (localStorage was moved) but none of its secrets:
 * "This device's sign-in keys are missing", on every synced app. `migrateLegacyVault` brings
 * them across. The old database is only ever READ — it stays as the fallback until a later cleanup.
 */
const LEGACY_DB = "karta-vault";
const LEGACY_PREFIX = "karta:";
const PREFIX = "potyro:";
/** Stored in the new vault once every legacy entry is across (or there was none), so this runs once. */
const MIGRATED = "__migrated:karta-vault";

/** An existing database, or `null` — never creating one, which a plain `open` would do. */
async function openExisting(idb: IDBFactory, name: string): Promise<IDBDatabase | null> {
  if (typeof idb.databases === "function") {
    try {
      if (!(await idb.databases()).some((d) => d.name === name)) return null;
    } catch {
      // Listing failed; the guarded open below still answers without creating anything.
    }
  }
  return new Promise((resolve) => {
    const open = idb.open(name);
    // Version 0 means it did not exist: abort the upgrade, and the browser discards the database.
    open.onupgradeneeded = (e) => {
      if (e.oldVersion === 0) open.transaction?.abort();
    };
    open.onsuccess = () => {
      if (open.result.objectStoreNames.contains(STORE)) return resolve(open.result);
      open.result.close();
      resolve(null);
    };
    open.onerror = () => resolve(null); // includes the abort above
    open.onblocked = () => resolve(null);
  });
}

/**
 * Copy every secret from the pre-rename vault into this one, under its new name.
 *
 * Decrypted with the OLD database's own key (it never left that profile, and still cannot), sealed
 * with this one's, read back, and compared — only then is the move marked done. A secret already in
 * this vault wins: it was written since the rename, by this build. Throws if any entry did not come
 * across intact, leaving the marker unset so the next open tries again.
 */
async function migrateLegacyVault(g: typeof globalThis, db: IDBDatabase, key: CryptoKey): Promise<void> {
  const subtle = g.crypto.subtle;
  const store = (mode?: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  if (await request(store().get(MIGRATED))) return;

  const legacy = await openExisting(g.indexedDB, LEGACY_DB);
  if (legacy) {
    try {
      const old = () => legacy.transaction(STORE).objectStore(STORE);
      const oldKey = (await request(old().get(KEY))) as CryptoKey | undefined;
      const names = oldKey ? ((await request(old().getAllKeys())) as IDBValidKey[]) : [];
      for (const name of names) {
        if (typeof name !== "string" || name === KEY) continue;
        const target = name.startsWith(LEGACY_PREFIX) ? PREFIX + name.slice(LEGACY_PREFIX.length) : name;
        if ((await request(store().get(target))) !== undefined) continue;
        const sealed = (await request(old().get(name))) as Sealed | undefined;
        if (!sealed) continue;
        let plain: ArrayBuffer;
        try {
          plain = await subtle.decrypt({ name: "AES-GCM", iv: sealed.iv }, oldKey!, sealed.data);
        } catch {
          continue; // unreadable there too (sealed under a key that profile lost): nothing to save
        }
        const iv = g.crypto.getRandomValues(new Uint8Array(12));
        const data = await subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
        await request(store("readwrite").put({ iv, data } satisfies Sealed, target));
        const back = (await request(store().get(target))) as Sealed;
        const check = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: back.iv }, key, back.data));
        const want = new Uint8Array(plain);
        if (check.length !== want.length || check.some((b, i) => b !== want[i])) {
          throw new Error(`vault: "${target}" did not read back as written`);
        }
      }
    } finally {
      legacy.close();
    }
  }
  await request(store("readwrite").put(true, MIGRATED));
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = idb.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("vault database blocked"));
  });
}

async function openVault(idb: IDBFactory, subtle: SubtleCrypto): Promise<{ db: IDBDatabase; key: CryptoKey } | null> {
  const db = await openDb(idb);
  const existing = await request(db.transaction(STORE).objectStore(STORE).get(KEY));
  if (existing) return { db, key: existing as CryptoKey };
  // Generated OUTSIDE the transaction (an IDB transaction commits as soon as it waits on
  // anything else), then added — `add`, not `put`, so a second tab that raced us keeps its key
  // and we read that one back instead of overwriting what it may already have encrypted with.
  const fresh = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  try {
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).add(fresh, KEY));
    return { db, key: fresh };
  } catch {
    const winner = await request(db.transaction(STORE).objectStore(STORE).get(KEY));
    return winner ? { db, key: winner as CryptoKey } : null;
  }
}

/**
 * The browser vault, or `null` where IndexedDB or WebCrypto is missing.
 *
 * The AES key is generated once per browser profile as non-extractable and stored in IndexedDB as a
 * `CryptoKey` object — structured-cloned by the browser, never as bytes a script can read.
 */
export function browserVault(g: typeof globalThis = globalThis): SecretVault | null {
  const idb = g.indexedDB;
  const subtle = g.crypto?.subtle;
  if (!idb || !subtle) return null;

  let ready: Promise<{ db: IDBDatabase; key: CryptoKey } | null> | null = null;
  const open = (): Promise<{ db: IDBDatabase; key: CryptoKey } | null> =>
    (ready ??= (async () => {
      let opened: { db: IDBDatabase; key: CryptoKey } | null;
      try {
        opened = await openVault(idb, subtle);
      } catch {
        return null; // private mode, blocked, quota: plain storage it is
      }
      if (!opened) return null;
      // Before anything reads a secret — so nothing can conclude one is missing while it is still
      // sitting in the pre-rename vault.
      try {
        await migrateLegacyVault(g, opened.db, opened.key);
      } catch (err) {
        console.warn("[potyro] could not bring the vault across from before the rename; retrying next start:", err);
      }
      return opened;
    })());

  return {
    available: async () => (await open()) !== null,

    async get(k) {
      const v = await open();
      if (!v) return null;
      const sealed = (await request(v.db.transaction(STORE).objectStore(STORE).get(k))) as Sealed | undefined;
      if (!sealed) return null;
      try {
        const plain = await subtle.decrypt({ name: "AES-GCM", iv: sealed.iv }, v.key, sealed.data);
        return new TextDecoder().decode(plain);
      } catch {
        return null; // sealed under a key this profile no longer has
      }
    },

    async set(k, value) {
      const v = await open();
      if (!v) throw new Error("The secret vault is not available here.");
      const iv = g.crypto.getRandomValues(new Uint8Array(12));
      const data = await subtle.encrypt({ name: "AES-GCM", iv }, v.key, new TextEncoder().encode(value));
      await request(v.db.transaction(STORE, "readwrite").objectStore(STORE).put({ iv, data } satisfies Sealed, k));
    },

    async remove(k) {
      const v = await open();
      if (!v) return;
      await request(v.db.transaction(STORE, "readwrite").objectStore(STORE).delete(k));
    },
  };
}

let registered: SecretVault | null = null;

/** Register the vault for this device. Called once by the composition root, before identity is read. */
export function setSecretVault(vault: SecretVault | null): void {
  registered = vault;
}

let fallback: SecretVault | null | undefined;

/** The registered vault, else the browser's own, else none. */
export function currentVault(): SecretVault | undefined {
  if (registered) return registered;
  if (fallback === undefined) fallback = browserVault();
  return fallback ?? undefined;
}
