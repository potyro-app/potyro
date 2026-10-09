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

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = idb.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("vault database blocked"));
  });
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
      try {
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
      } catch {
        return null; // private mode, blocked, quota: plain storage it is
      }
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
