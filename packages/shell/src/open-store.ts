// Durable store opener, shared by the boot composition root and the Studio runner. OPFS-backed
// SQLite (KA-01) when available; otherwise LocalStore so the app still runs and persists — just not
// as a real SQLite file. Firefox (and headless Chrome) lack the OPFS sync-access-handle pool the
// SAH VFS needs, so they take the LocalStore path by design — that's expected, not an error.

import { createSqliteStore, LocalStore, type Store } from "@karta/store";

export async function openStore(namespace: string): Promise<Store> {
  try {
    return await createSqliteStore(namespace);
  } catch {
    // Expected on Firefox / no-OPFS browsers — data still persists via localStorage.
    console.info(`[karta] Using local storage for "${namespace}" (OPFS SQLite unavailable in this browser).`);
    const store = new LocalStore();
    await store.open(namespace);
    return store;
  }
}
