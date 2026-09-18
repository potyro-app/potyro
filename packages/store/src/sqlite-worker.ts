// SQLite, in a worker, on real OPFS — the only place the browser allows it.
//
// ## Why this file exists
//
// `installOpfsSAHPoolVfs` needs `FileSystemFileHandle.createSyncAccessHandle`, and that method is
// **worker-only by specification**. It is absent on the main thread in every engine — Chrome and
// Firefox alike, headed and headless (measured). So the main-thread OPFS path could never succeed
// for anybody, and every device silently fell back to `idb-sqlite.ts`, which re-exports the WHOLE
// database and rewrites it into IndexedDB after every write.
//
// That fallback is O(everything the device has ever stored) per write. One database holds every
// synced app, its whole CRDT history and its photos, so ticking a checkbox in a five-line shopping
// list paid for the photo library of an unrelated app. Measured at phone-like CPU: 8ms per write at
// 0.2MB stored, 120ms at 11MB, and climbing in a straight line from there.
//
// In a worker the SAH-pool VFS installs and a write costs the write. That is the whole point.
//
// ## Shape
//
// One database per worker, named at construction. The protocol is a request id, an op, and a reply
// — deliberately small, because everything that crosses it is also everything that can go wrong
// across it. Messages are answered in the order they arrive, which is what lets the client wrap
// BEGIN/COMMIT around calls it makes in between (see `sqlite-worker-client.ts`).

/// <reference lib="webworker" />

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

interface Sqlite3Db {
  exec(sqlOrOpts: string | { sql: string; bind?: unknown[] }): unknown;
  selectObjects(sql: string, bind?: unknown[]): Record<string, unknown>[];
  selectValue(sql: string, bind?: unknown[]): unknown;
  close(): void;
}

export type WorkerRequest =
  | { id: number; op: "open"; name: string; directory?: string }
  | { id: number; op: "run"; sql: string; params?: unknown[] }
  | { id: number; op: "query"; sql: string; params?: unknown[] }
  | { id: number; op: "get"; sql: string; params?: unknown[] }
  | { id: number; op: "close" };

export type WorkerReply = { id: number; ok: true; rows?: Record<string, unknown>[] } | { id: number; ok: false; error: string };

let db: Sqlite3Db | null = null;

/** The module's own types do not describe its config argument; `sqlite-backend.ts` narrows it the
 *  same way, for the same reason. */
type InitFn = (config: { print?(): void; printErr?(): void }) => Promise<{
  installOpfsSAHPoolVfs?(opts: { name?: string; directory?: string }): Promise<{ OpfsSAHPoolDb: new (f: string) => Sqlite3Db }>;
}>;

async function open(name: string, directory?: string): Promise<void> {
  const init = sqlite3InitModule as unknown as InitFn;
  const sqlite3 = await init({ print: () => {}, printErr: () => {} });
  if (!sqlite3.installOpfsSAHPoolVfs) throw new Error("this worker has no OPFS SAH-pool VFS");
  const pool = await sqlite3.installOpfsSAHPoolVfs({
    name: `karta-${name}`,
    directory: directory ?? `/karta/${name}`,
  });
  db = new pool.OpfsSAHPoolDb(`/${name}.sqlite3`);
}

function handle(msg: WorkerRequest): Record<string, unknown>[] | undefined {
  if (!db) throw new Error("the database is not open");
  switch (msg.op) {
    case "run":
      db.exec({ sql: msg.sql, bind: msg.params ?? [] });
      return undefined;
    case "query":
      return db.selectObjects(msg.sql, msg.params ?? []);
    case "get":
      return db.selectObjects(msg.sql, msg.params ?? []).slice(0, 1);
    case "close":
      db.close();
      db = null;
      return undefined;
    default:
      throw new Error(`unknown op`);
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  const reply = (r: WorkerReply): void => self.postMessage(r);
  try {
    if (msg.op === "open") {
      await open(msg.name, msg.directory);
      reply({ id: msg.id, ok: true });
      return;
    }
    reply({ id: msg.id, ok: true, rows: handle(msg) });
  } catch (err) {
    // The client turns this back into a rejection. A worker that threw silently would leave the
    // caller waiting for a reply that is never coming.
    reply({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
