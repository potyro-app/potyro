// Ask the WebView to keep this app's storage (docs/27 §3.1).
//
// Every app, record and photo lives in the WebView's own storage (OPFS, IndexedDB, localStorage).
// WebKit evicts an origin's storage, whole and least-recently-used first, when the device runs short
// of space or the origin passes its quota — unless the origin is in persistent mode, which
// `navigator.storage.persist()` asks for (WebKit since iOS 17, Chromium's WebView too). The native app
// IS the person's data store, so it asks once per start. On the web a browser may answer with a
// prompt the person did not ask for (Firefox), so only the native shell asks.
//
// Nothing is reported: the answer is best-effort either way, and the storage report (You → storage)
// is where a device's state is read.

interface StorageManagerLike {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
}

/** Whether the storage is now persistent, or null when this cannot be asked here. Split out for tests. */
export async function keepStorageOn(storage: StorageManagerLike | undefined): Promise<boolean | null> {
  if (!storage?.persist) return null;
  try {
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return null;
  }
}

/** Ask, inside the native shell only. */
export async function keepStorage(): Promise<boolean | null> {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return keepStorageOn((globalThis.navigator as { storage?: StorageManagerLike } | undefined)?.storage);
}
