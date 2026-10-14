// The protocol between the main thread and the storage worker.
//
// What matters here is ORDER. cojson hands the driver a callback and issues statements inside it;
// those statements must reach SQLite between this client's BEGIN and its COMMIT, or a crash
// halfway through leaves half a change committed. The client never holds a lock across the
// callback — it relies on one channel answered in order — so that property is worth pinning.

import { describe, expect, it } from "vitest";
import { isStorageElsewhere, onStorageElsewhere, openWorkerSqlite, type WorkerFactory } from "../src/sqlite-worker-client.js";

/** A worker that records what it was asked, and answers in the order it was asked. */
function fakeWorker(): { factory: WorkerFactory; sql: string[]; terminated: () => boolean } {
  const sql: string[] = [];
  let stopped = false;
  const factory: WorkerFactory = () => {
    const w = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onerror: null as ((e: unknown) => void) | null,
      postMessage(message: unknown) {
        const m = message as { id: number; op: string; sql?: string };
        if (m.op !== "open" && m.op !== "close") sql.push(m.sql ?? m.op);
        // A real worker answers on a later task; answering synchronously would hide ordering bugs.
        setTimeout(() => w.onmessage?.({ data: { id: m.id, ok: true, rows: [{ user_version: 3 }] } }), 0);
      },
      terminate() {
        stopped = true;
      },
    };
    return w;
  };
  return { factory, sql, terminated: () => stopped };
}

/** A worker that records every operation, `open` and `close` included, and answers each one. */
function opsWorker(): { factory: WorkerFactory; ops: string[] } {
  const ops: string[] = [];
  const factory: WorkerFactory = () => {
    const w = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onerror: null as ((e: unknown) => void) | null,
      postMessage(message: unknown) {
        const m = message as { id: number; op: string };
        ops.push(m.op);
        setTimeout(() => w.onmessage?.({ data: { id: m.id, ok: true, rows: [] } }), 0);
      },
      terminate() {},
    };
    return w;
  };
  return { factory, ops };
}

describe("the storage worker client", () => {
  it("wraps the caller's statements in one transaction, in order", async () => {
    const { factory, sql } = fakeWorker();
    const { driver } = await openWorkerSqlite("tx-order", factory);

    await driver.transaction(async (tx) => {
      await tx.run("INSERT INTO coValues VALUES (?)", ["a"]);
      await tx.run("INSERT INTO sessions VALUES (?)", ["b"]);
    });

    expect(sql).toEqual(["BEGIN", "INSERT INTO coValues VALUES (?)", "INSERT INTO sessions VALUES (?)", "COMMIT"]);
  });

  it("rolls back and reports what actually failed", async () => {
    const { factory, sql } = fakeWorker();
    const { driver } = await openWorkerSqlite("tx-rollback", factory);

    await expect(
      driver.transaction(async () => {
        throw new Error("the record would not encode");
      }),
    ).rejects.toThrow("the record would not encode");

    expect(sql).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("keeps two nodes' transactions apart instead of merging them", async () => {
    // The app's store and the account node share this database, and therefore this driver. If their
    // transactions interleave, the second BEGIN lands inside the first transaction, the second
    // node's writes commit under the first's COMMIT, and a rollback on either side throws away the
    // other's work — which reads as a record that was written and never appeared.
    const { factory, sql } = fakeWorker();
    const { driver } = await openWorkerSqlite("two-nodes", factory);

    const first = driver.transaction(async (tx) => {
      await tx.run("INSERT INTO coValues VALUES (?)", ["first"]);
    });
    const second = driver.transaction(async (tx) => {
      await tx.run("INSERT INTO coValues VALUES (?)", ["second"]);
    });
    await Promise.all([first, second]);

    expect(sql).toEqual([
      "BEGIN",
      "INSERT INTO coValues VALUES (?)",
      "COMMIT",
      "BEGIN",
      "INSERT INTO coValues VALUES (?)",
      "COMMIT",
    ]);
  });

  it("fails outstanding calls when the worker dies instead of waiting forever", async () => {
    const sql: string[] = [];
    // A holder, not a bare `let`: assigned inside the factory closure, TypeScript narrows a plain
    // variable to `never` at the call below.
    const dies: { now?: () => void } = {};
    const factory: WorkerFactory = () => {
      const w = {
        onmessage: null as ((e: { data: unknown }) => void) | null,
        onerror: null as ((e: unknown) => void) | null,
        postMessage(message: unknown) {
          const m = message as { id: number; op: string; sql?: string };
          // Only `open` is answered; the statement after it is left hanging, then the worker dies.
          if (m.op === "open") setTimeout(() => w.onmessage?.({ data: { id: m.id, ok: true } }), 0);
          else sql.push(m.sql ?? m.op);
        },
        terminate() {},
      };
      dies.now = () => w.onerror?.({});
      return w;
    };
    const { driver } = await openWorkerSqlite("worker-dies", factory);

    const pending = driver.run("INSERT INTO coValues VALUES (?)", ["a"]);
    dies.now?.();

    await expect(pending).rejects.toThrow("the storage worker stopped");
  });

  it("gives the same database the same connection", async () => {
    // Two callers want one database at boot: an app opening its store, and the account node the
    // launcher reads. A second connection over the same SAH pool never finishes opening, so the
    // second caller must get the first one rather than a new one.
    let spawned = 0;
    const { factory } = fakeWorker();
    const counting: WorkerFactory = () => {
      spawned++;
      return factory();
    };

    const first = await openWorkerSqlite("shared-db", counting);
    const second = await openWorkerSqlite("shared-db", counting);

    expect(spawned).toBe(1);
    // One connection, but a handle each: closing is per caller (below).
    expect(second).not.toBe(first);
  });

  it("keeps a database open while anyone still holds it", async () => {
    // An app has its store open and the Data panel opens the same one. Whichever closes first must
    // not close the database under the other: the worker's `close` shuts it for everyone, and every
    // statement after that failed with "is not open".
    const { factory, ops } = opsWorker();
    const app = await openWorkerSqlite("held-twice", factory);
    const panel = await openWorkerSqlite("held-twice", factory);
    await panel.driver.closeDb();
    await panel.driver.closeDb(); // twice from one holder is still one release
    await app.driver.run("INSERT INTO records VALUES (?)", ["a"]);
    expect(ops).toEqual(["open", "run"]);

    await app.driver.closeDb();
    expect(ops).toEqual(["open", "run", "close"]);
  });

  it("opens a closed database again instead of handing out the closed one", async () => {
    // Going home closes an app's store; opening the app again in place asked for the same name and
    // got the cached connection to a database the worker had already closed. The store then fell
    // back to localStorage — and showed none of the records in the real database.
    const { factory, ops } = opsWorker();
    const first = await openWorkerSqlite("reopened", factory);
    await first.driver.closeDb();
    const again = await openWorkerSqlite("reopened", factory);
    await again.driver.run("SELECT 1", []);

    expect(ops).toEqual(["open", "close", "open", "run"]);
  });

  it("addresses every statement to the database it belongs to", async () => {
    // One worker holds one pool and a database per name — apps do not get a pool each, which is how
    // a device with a handful of them ran out of sync access handles mid-save. That only works if
    // each statement says which database it is for.
    const addressed: string[] = [];
    const factory: WorkerFactory = () => {
      const w = {
        onmessage: null as ((e: { data: unknown }) => void) | null,
        onerror: null as ((e: unknown) => void) | null,
        postMessage(message: unknown) {
          const m = message as { id: number; op: string; db?: string };
          addressed.push(`${m.op}:${m.db ?? "—"}`);
          setTimeout(() => w.onmessage?.({ data: { id: m.id, ok: true, rows: [] } }), 0);
        },
        terminate() {},
      };
      return w;
    };

    const notes = await openWorkerSqlite("user-notes", factory);
    await notes.driver.run("INSERT INTO records VALUES (?)", ["a"]);

    expect(addressed).toEqual(["open:user-notes", "run:user-notes"]);
  });

  it("reads the migration version out of the pragma row", async () => {
    const { factory } = fakeWorker();
    const { driver } = await openWorkerSqlite("pragma-version", factory);

    expect(await driver.getMigrationVersion?.()).toBe(3);
  });

  // Another tab owns the storage (storage-owner.ts). That must reach the caller as itself — callers
  // fall back to other storage on any other error, and a fallback here is a second copy of the apps.
  it("says when another tab has the storage, so nobody falls back to a second copy", async () => {
    const factory: WorkerFactory = () => {
      const w = {
        onmessage: null as ((e: { data: unknown }) => void) | null,
        postMessage(message: unknown) {
          const m = message as { id: number };
          setTimeout(() => w.onmessage?.({ data: { id: m.id, ok: false, error: "Potyro is open in another tab", code: "storage-elsewhere" } }), 0);
        },
        terminate() {},
      };
      return w;
    };
    let told = 0;
    const stop = onStorageElsewhere(() => told++);
    const err = await openWorkerSqlite("held-elsewhere", factory).catch((e: unknown) => e);
    stop();
    expect(isStorageElsewhere(err)).toBe(true);
    expect(told).toBe(1);
  });

  it("fails what is still waiting when another tab takes the storage over", async () => {
    let worker: { onmessage: ((e: { data: unknown }) => void) | null } | null = null;
    const factory: WorkerFactory = () => {
      const w = {
        onmessage: null as ((e: { data: unknown }) => void) | null,
        postMessage(message: unknown) {
          const m = message as { id: number; op: string };
          // The open is answered; the query after it never is, because the files are handed on.
          if (m.op === "open") setTimeout(() => w.onmessage?.({ data: { id: m.id, ok: true } }), 0);
          else setTimeout(() => w.onmessage?.({ data: { event: "lost" } }), 0);
        },
        terminate() {},
      };
      worker = w;
      return w;
    };
    const { driver } = await openWorkerSqlite("taken-over", factory);
    expect(worker).not.toBeNull();
    const err = await driver.query("SELECT 1", []).catch((e: unknown) => e);
    expect(isStorageElsewhere(err)).toBe(true);
  });
});
