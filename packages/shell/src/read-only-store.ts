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

import type { Store } from "@potyro/store";

export class SchemaBehindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaBehindError";
  }
}

/** Wrap `store` so every mutating call throws. Reads, subscriptions and blobs pass through. */
export function readOnlyStore(store: Store, reason: string): Store {
  return guardedStore(store, () => reason);
}

/**
 * Wrap `store` so a mutating call throws WHILE `refusal()` returns a reason, and passes through
 * otherwise.
 *
 * The switch is read per call rather than fixed at wrap time because what it guards changes while
 * the app is open: a collaborator publishes a newer schema mid-session, and the runtime — already
 * composed over this store — must stop writing from that moment, not from the next open.
 */
export function guardedStore(store: Store, refusal: () => string | null): Store {
  // A REJECTED PROMISE, not a synchronous throw. Every `Store` method is typed as returning a
  // promise, so callers `await` them; throwing synchronously would escape a `.catch()` and blow up
  // in a different place than the one that handles store failures.
  const write =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => {
      const reason = refusal();
      return reason ? Promise.reject(new SchemaBehindError(reason)) : fn(...args);
    };

  return {
    // What the app declared. Not a write — and dropped, it silently turned off the CRDT store's
    // per-element merge of set fields (KA-38) for every shared app, the moment this wrapper started
    // guarding all of them (#63).
    describe: store.describe ? (schema, rules) => store.describe!(schema, rules) : undefined,
    open: (appId) => store.open(appId),
    close: () => store.close(),
    all: (entity, narrow) => store.all(entity, narrow),
    get: (entity, id) => store.get(entity, id),
    byIndex: store.byIndex ? (entity, field, value) => store.byIndex!(entity, field, value) : undefined,
    subscribe: (entity, cb) => store.subscribe(entity, cb),
    getBlob: (ref) => store.getBlob(ref),
    subscribeBlob: store.subscribeBlob ? (ref, cb) => store.subscribeBlob!(ref, cb) : undefined,
    kvGet: (k) => store.kvGet(k),
    listFiles: () => store.listFiles(),
    getFile: (id) => store.getFile(id),
    subscribeFiles: store.subscribeFiles ? (cb) => store.subscribeFiles!(cb) : undefined,
    kvKeys: store.kvKeys ? (prefix) => store.kvKeys!(prefix) : undefined,
    subscribeKv: store.subscribeKv ? (cb) => store.subscribeKv!(cb) : undefined,
    memberIds: store.memberIds ? () => store.memberIds!() : undefined,
    storedSchemaVersion: () => store.storedSchemaVersion(),
    // Reads of the space's own log. Dropping them made a locked app lose its Changes and Chat
    // buttons, which is the opposite of what someone asking "why can't I edit?" needs.
    editHistory: store.editHistory ? (entity, id, opts) => store.editHistory!(entity, id, opts) : undefined,
    messages: store.messages ? (thread, opts) => store.messages!(thread, opts) : undefined,
    subscribeMessages: store.subscribeMessages ? (thread, cb) => store.subscribeMessages!(thread, cb) : undefined,
    // A message is not app data: it lives outside the entity tree in no schema's shape, so an old
    // copy cannot corrupt anything by sending one — and "please update" is worth being able to say.
    postMessage: store.postMessage ? (thread, text) => store.postMessage!(thread, text) : undefined,

    insert: write((entity: string, rec: Parameters<Store["insert"]>[1]) => store.insert(entity, rec)),
    update: write((entity: string, id: string, patch: Parameters<Store["update"]>[2]) => store.update(entity, id, patch)),
    delete: write((entity: string, id: string) => store.delete(entity, id)),
    increment: store.increment
      ? write((entity: string, id: string, field: string, delta: number) => store.increment!(entity, id, field, delta))
      : undefined,
    putBlob: write((b: Blob) => store.putBlob(b)),
    putBlobWithKey: store.putBlobWithKey ? write((key: string, b: Blob) => store.putBlobWithKey!(key, b)) : undefined,
    kvSet: write((k: string, v: string) => store.kvSet(k, v)),
    // A file is app data like a record: an old copy writing one could put it where the current app
    // does not expect it, so the folder is read-only while the app is.
    deleteBlob: write((key: string) => store.deleteBlob(key)),
    setFile: write((entry: Parameters<Store["setFile"]>[0]) => store.setFile(entry)),
    deleteFile: write((id: string) => store.deleteFile(id)),
    kvDelete: write((k: string) => store.kvDelete(k)),
    runMigrations: write((plan: Parameters<Store["runMigrations"]>[0]) => store.runMigrations(plan)),
    // A transaction that could only fail should fail immediately, not part-way through.
    transaction: (fn) => {
      const reason = refusal();
      return reason ? Promise.reject(new SchemaBehindError(reason)) : store.transaction(fn);
    },
  } as Store;
}
