// The protocol between the main thread and the storage worker.
//
// What matters here is ORDER. cojson hands the driver a callback and issues statements inside it;
// those statements must reach SQLite between this client's BEGIN and its COMMIT, or a crash
// halfway through leaves half a change committed. The client never holds a lock across the
// callback — it relies on one channel answered in order — so that property is worth pinning.

import { describe, expect, it } from "vitest";
import { openWorkerSqlite, type WorkerFactory } from "../src/sqlite-worker-client.js";

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

  it("shares one worker per database, because OPFS handles are exclusive", async () => {
    // Two callers want the same database at boot: an app opening its store, and the account node
    // the launcher reads. A second worker over the same SAH pool never finishes opening, so the
    // second caller must get the first worker rather than a new one.
    let spawned = 0;
    const { factory } = fakeWorker();
    const counting: WorkerFactory = () => {
      spawned++;
      return factory();
    };

    const first = await openWorkerSqlite("shared-db", counting);
    const second = await openWorkerSqlite("shared-db", counting);

    expect(spawned).toBe(1);
    expect(second).toBe(first);
  });

  it("reads the migration version out of the pragma row", async () => {
    const { factory } = fakeWorker();
    const { driver } = await openWorkerSqlite("pragma-version", factory);

    expect(await driver.getMigrationVersion?.()).toBe(3);
  });
});
