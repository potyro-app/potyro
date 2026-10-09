// One-time move of the browser's storage keys from the codename prefix to the product's (#114).
// Everything the shell keeps in localStorage — identity, the installed-app list, which database a
// namespace lives in, per-app watermarks — sits under one prefix, so the move is generic: every
// `karta:` key becomes the same key under `potyro:`, values untouched. The database FILES keep their
// names (`karta-jazz` on OPFS, `karta-jazz-idb` in IndexedDB): the moved `…:jazz:db:` keys still
// name them, and renaming a file on every device buys nothing a person can see.
//
// main.tsx imports this module before anything else, because several shell modules read
// localStorage while they are being evaluated, and the move has to be done by then.

const OLD_PREFIX = "karta:";
const NEW_PREFIX = "potyro:";

/** Moves every `karta:` key to `potyro:`; returns how many were moved. A key that already exists
 *  under the new prefix wins — it was written by this build — and the old one is dropped. */
export function migrateStorageKeys(storage: Storage | undefined = globalThis.localStorage): number {
  if (!storage) return 0;
  const old: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(OLD_PREFIX)) old.push(key);
  }
  for (const key of old) {
    const target = NEW_PREFIX + key.slice(OLD_PREFIX.length);
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(target) === null) storage.setItem(target, value);
    storage.removeItem(key);
  }
  return old.length;
}

try {
  migrateStorageKeys();
} catch {
  // Storage blocked (private mode, a sandboxed frame): there is nothing to move.
}
