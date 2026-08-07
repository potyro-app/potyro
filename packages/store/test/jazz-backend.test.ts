// Durability for JazzStore (KA-08). This is the property that gates wiring JazzStore into the
// shell at all: without it a sync-enabled app would silently lose everything on reload, which is
// strictly worse than not offering sync.
//
// The test "reloads" by building a SECOND node against the same SQLite handle and the same
// remembered ids — exactly what the browser does on refresh. It would pass trivially if the store
// merely kept CoValues in memory, so the second node is constructed from scratch.

import { beforeAll, describe, expect, it } from "vitest";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import { createJazzStore, initSqlite, type JazzKeyStore } from "../src/index.js";

let crypto: Awaited<ReturnType<typeof WasmCrypto.create>>;
beforeAll(async () => {
  crypto = await WasmCrypto.create();
});

/** localStorage stand-in — the browser passes the real thing. */
function memoryKeys(): JazzKeyStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

async function memoryDb() {
  const sqlite3 = await initSqlite();
  return new sqlite3.oo1.DB(":memory:", "c");
}

describe("createJazzStore durability", () => {
  it("data written before a reload is still there afterwards", async () => {
    const db = await memoryDb();
    const keys = memoryKeys();

    const first = await createJazzStore("split", { db, crypto, keys });
    const written = await first.store.insert("expense", { description: "Dinner", amountCents: 4200 });
    // NO sleep. `insert` does not resolve until the write is durable, so a reload racing a fast
    // refresh cannot lose it. Before that guarantee this test failed without a ~500ms wait.

    // "Reload": a brand-new node over the same storage + the same remembered ids.
    const second = await createJazzStore("split", { db, crypto, keys });
    const rows = await second.store.all("expense");

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(written.id);
    expect(rows[0]!.description).toBe("Dinner");
    expect(rows[0]!.amountCents).toBe(4200);
  });

  it("keeps the same device account and app space across reloads", async () => {
    const db = await memoryDb();
    const keys = memoryKeys();

    const first = await createJazzStore("split", { db, crypto, keys });
    const second = await createJazzStore("split", { db, crypto, keys });

    // A new account each load would orphan the previous data and break sharing (the account IS
    // the identity a group grants roles to).
    expect(second.accountID).toBe(first.accountID);
    expect(second.groupID).toBe(first.groupID);
    expect(second.store.rootId).toBe(first.store.rootId);
  });

  it("gives two apps separate spaces on one device identity", async () => {
    const db = await memoryDb();
    const keys = memoryKeys();

    const split = await createJazzStore("split", { db, crypto, keys });
    const plants = await createJazzStore("plants", { db, crypto, keys });

    expect(plants.accountID).toBe(split.accountID); // same person
    expect(plants.groupID).not.toBe(split.groupID); // different space
    expect(plants.store.rootId).not.toBe(split.store.rootId);

    await split.store.insert("expense", { description: "Dinner" });
    expect(await plants.store.all("expense")).toHaveLength(0); // no leakage between apps
  });
});
