import { describe, expect, it, vi } from "vitest";
import { createMemorySqliteStore, type SqliteStoreFactoryResult } from "../src/index.js";

// SqliteStore must satisfy the same Store contract as MemoryStore (KA-01: "passes the current store
// test suite unchanged"). This mirrors memory-store.test.ts against the SQLite-WASM backend, then
// adds a durability test using byte export/import to simulate an OPFS reload headlessly.

async function seeded(appId = "test"): Promise<SqliteStoreFactoryResult> {
  return createMemorySqliteStore(appId);
}

describe("SqliteStore CRUD", () => {
  it("inserts with generated id + timestamps and reads back a clone", async () => {
    const { store: s } = await seeded();
    const r = await s.insert("task", { title: "a" });
    expect(r.id).toBeTruthy();
    expect(r.createdAt).toBeTruthy();
    expect(r.updatedAt).toBeTruthy();

    const got = await s.get("task", r.id);
    expect(got).toEqual(r);
    // mutating the returned clone must not affect the store
    got!.title = "mutated";
    const again = await s.get("task", r.id);
    expect(again!.title).toBe("a");
  });

  it("updates preserve id/createdAt and bump updatedAt", async () => {
    const { store: s } = await seeded();
    const r = await s.insert("task", { title: "a" });
    await new Promise((res) => setTimeout(res, 2));
    const u = await s.update("task", r.id, { title: "b" });
    expect(u.id).toBe(r.id);
    expect(u.createdAt).toBe(r.createdAt);
    expect(u.title).toBe("b");
  });

  it("all() returns rows in creation order and supports narrowing", async () => {
    const { store: s } = await seeded();
    const a = await s.insert("task", { title: "a" });
    const b = await s.insert("task", { title: "b" });
    const rows = await s.all("task");
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
    expect((await s.all("task", { limit: 1 })).length).toBe(1);
    expect((await s.all("task", { ids: [b.id] })).map((r) => r.title)).toEqual(["b"]);
  });

  it("all() by ids reads only those rows, through the index", async () => {
    // The runtime resolves a list's relations with one `all(entity, { ids })` per related entity.
    // Answering it by reading and parsing the whole entity would make a batch of 5 cost as much as
    // the entire table; the (entity, id) key already indexes exactly this lookup.
    const { store: s } = await seeded();
    const rows = [];
    for (let i = 0; i < 1000; i++) rows.push(await s.insert("task", { title: `t${i}` }));
    const wanted = [rows[900]!.id, rows[3]!.id, "missing", rows[3]!.id];

    const parse = vi.spyOn(JSON, "parse");
    const got = await s.all("task", { ids: wanted });
    const parsed = parse.mock.calls.length;
    parse.mockRestore();

    // Creation order, as `all` always returns; an id that is not there is simply absent.
    expect(got.map((r) => r.title)).toEqual(["t3", "t900"]);
    expect(parsed).toBe(2);
    expect(await s.all("task", { ids: [] })).toEqual([]);
  });

  it("all() by ids copes with more ids than SQLite takes in one statement", async () => {
    const { store: s } = await seeded();
    const ids = [];
    for (let i = 0; i < 1200; i++) ids.push((await s.insert("task", { title: `t${i}` })).id);
    const got = await s.all("task", { ids, offset: 10, limit: 5 });
    expect(got.map((r) => r.title)).toEqual(["t10", "t11", "t12", "t13", "t14"]);
    expect((await s.all("task", { ids })).length).toBe(1200);
  });

  it("delete removes the record", async () => {
    const { store: s } = await seeded();
    const r = await s.insert("task", { title: "a" });
    await s.delete("task", r.id);
    expect(await s.get("task", r.id)).toBeNull();
  });
});

describe("SqliteStore reactivity", () => {
  it("notifies subscribers on writes to that entity", async () => {
    const { store: s } = await seeded();
    const cb = vi.fn();
    const unsub = s.subscribe("task", cb);
    await s.insert("task", { title: "a" });
    expect(cb).toHaveBeenCalledTimes(1);
    await s.insert("other", { title: "x" });
    expect(cb).toHaveBeenCalledTimes(1); // different entity
    unsub();
    await s.insert("task", { title: "b" });
    expect(cb).toHaveBeenCalledTimes(1); // unsubscribed
  });
});

describe("SqliteStore transactions", () => {
  it("rolls back on throw", async () => {
    const { store: s } = await seeded();
    await s.insert("task", { title: "keep" });
    await expect(
      s.transaction(async (tx) => {
        await tx.insert("task", { title: "gone" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await s.all("task");
    expect(rows.map((r) => r.title)).toEqual(["keep"]);
  });
});

describe("SqliteStore transaction notifications", () => {
  it("buffers notifications: none on rollback, one on commit", async () => {
    const { store: s } = await seeded();
    const cb = vi.fn();
    s.subscribe("task", cb);

    await expect(
      s.transaction(async (tx) => {
        await tx.insert("task", { title: "gone" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(cb).not.toHaveBeenCalled(); // rolled back → no phantom notification

    await s.transaction(async (tx) => {
      await tx.insert("task", { title: "kept" });
    });
    expect(cb).toHaveBeenCalledTimes(1); // committed → exactly one flush
  });
});

describe("SqliteStore blobs + kv", () => {
  it("round-trips a blob", async () => {
    const { store: s } = await seeded();
    const ref = await s.putBlob(new Blob(["hello"], { type: "text/plain" }));
    const back = await s.getBlob(ref);
    expect(await back!.text()).toBe("hello");
  });

  it("round-trips kv", async () => {
    const { store: s } = await seeded();
    await s.kvSet("k", "v");
    expect(await s.kvGet("k")).toBe("v");
    await s.kvDelete("k");
    expect(await s.kvGet("k")).toBeNull();
  });
});

describe("SqliteStore migrations", () => {
  it("applies declarative ops and bumps schema version", async () => {
    const { store: s } = await seeded();
    await s.insert("recipe", { name: "Soup", notes: "old" });
    await s.runMigrations({
      fromAppVersion: "1.0.0",
      toAppVersion: "1.1.0",
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      migrations: [
        {
          from: "1.0.0",
          to: "1.1.0",
          steps: [
            { op: "addField", entity: "recipe", field: "timesCooked", default: 0 },
            { op: "renameField", entity: "recipe", from: "notes", to: "description" },
            { op: "changeType", entity: "recipe", field: "timesCooked", to: "number", via: (v: unknown) => Number(v) },
            { transform: (r) => ({ ...r, slug: String(r.name).toLowerCase() }) },
          ],
        },
      ],
    });
    const [r] = await s.all("recipe");
    expect(r.timesCooked).toBe(0);
    expect(r.description).toBe("old");
    expect(r.notes).toBeUndefined();
    expect(r.slug).toBe("soup");
    expect(await s.storedSchemaVersion()).toBe(2);
  });
});

describe("SqliteStore durability (OPFS reload simulated via export/import)", () => {
  it("survives a reopen with the exported bytes", async () => {
    const first = await createMemorySqliteStore("recipes");
    const r = await first.store.insert("recipe", { name: "Soup", when: new Date("2026-07-22T00:00:00Z") });
    await first.store.kvSet("pantry", JSON.stringify(["egg"]));
    const blob = await first.store.putBlob(new Blob(["img"], { type: "image/png" }));
    await first.store.runMigrations({
      fromAppVersion: null,
      toAppVersion: "1.0.0",
      fromSchemaVersion: 0,
      toSchemaVersion: 1,
      migrations: [],
    });
    const bytes = first.export();
    first.destroy();

    // "reload": a brand-new store seeded from the exported bytes
    const reopened = await createMemorySqliteStore("recipes", { bytes });
    const rows = await reopened.store.all("recipe");
    expect(rows.map((x) => x.name)).toEqual(["Soup"]);
    expect(rows[0].id).toBe(r.id);
    expect(await reopened.store.kvGet("pantry")).toBe(JSON.stringify(["egg"]));
    expect(await reopened.store.storedSchemaVersion()).toBe(1);
    const back = await reopened.store.getBlob(blob);
    expect(await back!.text()).toBe("img");
    reopened.destroy();
  });
});
