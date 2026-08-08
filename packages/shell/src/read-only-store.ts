// A Store that refuses to write (KA-22).
//
// Used when this device's copy of an app is behind the schema version the space is now writing.
// Reading stale data is confusing; WRITING with an old schema is corrupting — the record goes into
// the shared document in a shape the current app does not expect, and every other peer replicates
// it. So the gate blocks writes specifically, and keeps reads working so the user can still see
// their data and understand why they are stuck.
//
// Refusing loudly is the point. A silent no-op would look like the app was broken; the error names
// the cause and the way out.

import type { Store } from "@karta/store";

export class SchemaBehindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaBehindError";
  }
}

/** Wrap `store` so every mutating call throws. Reads, subscriptions and blobs pass through. */
export function readOnlyStore(store: Store, reason: string): Store {
  // A REJECTED PROMISE, not a synchronous throw. Every `Store` method is typed as returning a
  // promise, so callers `await` them; throwing synchronously would escape a `.catch()` and blow up
  // in a different place than the one that handles store failures.
  const refuse = (): Promise<never> => Promise.reject(new SchemaBehindError(reason));

  return {
    open: (appId) => store.open(appId),
    close: () => store.close(),
    all: (entity, narrow) => store.all(entity, narrow),
    get: (entity, id) => store.get(entity, id),
    byIndex: store.byIndex ? (entity, field, value) => store.byIndex!(entity, field, value) : undefined,
    subscribe: (entity, cb) => store.subscribe(entity, cb),
    getBlob: (ref) => store.getBlob(ref),
    kvGet: (k) => store.kvGet(k),
    kvKeys: store.kvKeys ? (prefix) => store.kvKeys!(prefix) : undefined,
    storedSchemaVersion: () => store.storedSchemaVersion(),

    insert: refuse,
    update: refuse,
    delete: refuse,
    putBlob: refuse,
    putBlobWithKey: refuse,
    kvSet: refuse,
    kvDelete: refuse,
    runMigrations: refuse,
    // A transaction that could only fail should fail immediately, not part-way through.
    transaction: refuse,
  } as Store;
}
