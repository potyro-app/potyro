// Who changed what, when — read out of the CRDT log (KA-36).
//
// The point of these tests is that NOTHING IS STORED to make this work. A record is a CoMap and a
// write is a per-key signed transaction, so the history is a by-product of the merge strategy. Two
// consequences worth pinning, because they are what make the feature worth building on:
//
//   - the author comes from the SIGNING SESSION, not from a field, so it cannot be forged by app
//     code the way an app-emitted "system message" could;
//   - it works RETROACTIVELY, for edits made long before anyone thought of an activity feed.
//
// And one that must not be papered over: `MemoryStore` and `SqliteStore` genuinely cannot answer
// this. They must be ABSENT (`editHistory === undefined`), not present-and-empty, so a caller can
// tell "nothing changed" from "this store cannot tell you".

import { beforeAll, describe, expect, it } from "vitest";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import { createJazzStore, initSqlite, MemoryStore, type JazzKeyStore, type Store } from "../src/index.js";

let crypto: Awaited<ReturnType<typeof WasmCrypto.create>>;
beforeAll(async () => {
  crypto = await WasmCrypto.create();
});

function memoryKeys(): JazzKeyStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

async function memoryDb() {
  const sqlite3 = await initSqlite();
  return new sqlite3.oo1.DB(":memory:", "c");
}

async function store() {
  const handle = await createJazzStore("activity", { db: await memoryDb(), crypto, keys: memoryKeys() });
  return handle;
}

describe("editHistory", () => {
  it("reports each field change with its author and time", async () => {
    const { store: s, accountID } = await store();
    const row = await s.insert("item", { name: "Milk", qty: 1 });
    await s.update("item", row.id, { qty: 3 });

    const edits = await s.editHistory!("item", row.id);
    const qty = edits.filter((e) => e.field === "qty");

    expect(qty.map((e) => e.value)).toEqual([1, 3]); // oldest first
    expect(qty.every((e) => e.by === accountID)).toBe(true);
    expect(qty.every((e) => e.at instanceof Date)).toBe(true);
  });

  it("gives the whole record's edits in the order they happened", async () => {
    const { store: s } = await store();
    const row = await s.insert("item", { name: "Milk", qty: 1 });
    await s.update("item", row.id, { qty: 2 });
    await s.update("item", row.id, { name: "Whole milk" });

    const edits = await s.editHistory!("item", row.id);
    const times = edits.map((e) => e.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // The insert counts: a created record is a change someone made.
    expect(edits.map((e) => e.field)).toContain("name");
    expect(edits.filter((e) => e.field === "qty").length).toBe(2);
  });

  it("skips the bookkeeping this store writes itself", async () => {
    // "Ana changed updatedAt" is noise, not activity.
    const { store: s } = await store();
    const row = await s.insert("item", { name: "Milk" });
    await s.update("item", row.id, { name: "Bread" });

    const fields = new Set((await s.editHistory!("item", row.id)).map((e) => e.field));
    for (const noise of ["id", "createdAt", "createdBy", "updatedAt"]) expect(fields.has(noise)).toBe(false);
  });

  it("windows by `since`, which is what keeps a feed affordable", async () => {
    // The log grows with every edit ever made and never shrinks (KA-30), so folding all of it to
    // render "what changed lately" gets slower for as long as the app is used.
    const { store: s } = await store();
    const row = await s.insert("item", { name: "Milk", qty: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const watermark = new Date();
    await new Promise((r) => setTimeout(r, 5));
    await s.update("item", row.id, { qty: 9 });

    const recent = await s.editHistory!("item", row.id, { since: watermark });
    expect(recent.map((e) => ({ field: e.field, value: e.value }))).toEqual([{ field: "qty", value: 9 }]);
  });

  it("works retroactively — the history predates any feature reading it", async () => {
    // Nothing opted in, nothing was recorded on the side: the edits are simply already there.
    const { store: s } = await store();
    const row = await s.insert("item", { name: "Milk" });
    await s.update("item", row.id, { name: "Oat milk" });

    expect((await s.editHistory!("item", row.id)).length).toBeGreaterThan(1);
  });

  it("returns nothing for a record that does not exist", async () => {
    const { store: s } = await store();
    expect(await s.editHistory!("item", "co_zMissing")).toEqual([]);
  });
});

describe("stores that cannot answer say so", () => {
  it("MemoryStore has no editHistory at all", async () => {
    // ABSENT, not empty. A feature built on this must be able to tell "nothing changed" from "this
    // store keeps no history", and an empty array would quietly claim the first.
    // Typed as `Store`, because that is the contract a caller holds — the whole question is what a
    // caller can rely on, and `editHistory` is optional there.
    const s: Store = new MemoryStore();
    await s.open("activity");
    expect(s.editHistory).toBeUndefined();
  });
});
