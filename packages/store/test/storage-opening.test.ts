// Two callers opening cojson storage over the same database at once (#273's red gate): an app's store
// and the launcher's account read share the worker's connection, each through its own driver
// wrapper. Opening storage runs cojson's migrations from whatever `user_version` it reads, so two
// openings in flight both read 0, both migrate, and the second dies on "duplicate column name".
import { describe, expect, it } from "vitest";
import { storageOver } from "../src/jazz-backend.js";
import type { SqliteDriverAsync } from "../src/jazz-sqlite-driver.js";

/** One database, as two callers see it: a separate driver object each, the same state underneath. */
function sharedDatabase() {
  const db = { version: 0, ran: [] as string[] };
  const tick = () => new Promise((r) => setTimeout(r, 1));
  const driver = (): SqliteDriverAsync => ({
    initialize: async () => tick(),
    run: async (sql) => {
      await tick();
      const added = /ADD COLUMN (\w+)/i.exec(sql)?.[1];
      if (added && db.ran.includes(added)) throw new Error(`duplicate column name: ${added}`);
      if (added) db.ran.push(added);
    },
    query: async () => [],
    get: async () => undefined,
    transaction: async (cb) => cb(driver()),
    closeDb: async () => undefined,
    getMigrationVersion: async () => {
      await tick();
      return db.version;
    },
    saveMigrationVersion: async (v) => {
      await tick();
      db.version = v;
    },
  });
  return { db, driver };
}

describe("opening storage over a shared database", () => {
  it("two openings at once migrate it once, and both succeed", async () => {
    const { db, driver } = sharedDatabase();
    await expect(Promise.all([storageOver(driver()), storageOver(driver())])).resolves.toHaveLength(2);
    expect(db.ran).toContain("bytesSinceLastSignature");
    expect(new Set(db.ran).size).toBe(db.ran.length);
  });

  it("an opening that fails does not hold up the next", async () => {
    const { driver } = sharedDatabase();
    const broken: SqliteDriverAsync = { ...driver(), initialize: async () => Promise.reject(new Error("no worker")) };
    await expect(storageOver(broken)).rejects.toThrow("no worker");
    await expect(storageOver(driver())).resolves.toBeDefined();
  });
});
