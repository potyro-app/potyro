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
  it("addRecord makes the record existing ones are pointed at, once", async () => {
    const { store: s } = await seeded();
    await s.insert("todo", { title: "Milk" });
    const plan = {
      fromAppVersion: "1.0.0",
      toAppVersion: "2.0.0",
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      migrations: [
        {
          from: "1.0.0",
          to: "2.0.0",
          steps: [
            { op: "addRecord" as const, entity: "list", id: "first-list", values: { name: "Shopping" } },
            { op: "addField" as const, entity: "todo", field: "list", default: "first-list" },
          ],
        },
      ],
    };
    await s.runMigrations(plan);
    // Run again (another device, or a retry): still one list, and its name is not overwritten.
    await s.update("list", "first-list", { name: "Weekly shop" });
    await s.runMigrations({ ...plan, fromSchemaVersion: 2, toSchemaVersion: 2 });
    const lists = await s.all("list");
    expect(lists.map((l) => [l.id, l.name])).toEqual([["first-list", "Weekly shop"]]);
    const [todo] = await s.all("todo");
    expect(todo.list).toBe("first-list");
  });
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

// A read of an entity that has not changed is the first read's rows again (one statement for
// sixteen readers); any change forgets it; and what a read hands out stays a clone of its own.
describe("SqliteStore remembers what it read", () => {
  type Counted = SqliteStoreFactoryResult & { selects: () => number };
  async function counted(): Promise<Counted> {
    const made = await createMemorySqliteStore("counted");
    const db = (made.store as unknown as { db: { selectObjects: (...a: unknown[]) => unknown } }).db;
    let selects = 0;
    const real = db.selectObjects.bind(db);
    db.selectObjects = (...a: unknown[]) => {
      if (typeof a[0] === "string" && a[0].startsWith("SELECT") && a[0].includes("FROM records")) selects++;
      return real(...a);
    };
    return { ...made, selects: () => selects };
  }

  it("reads an unchanged entity from the database once, however many times it is asked", async () => {
    const { store: s, selects } = await counted();
    await s.insert("task", { title: "a" });
    await s.insert("task", { title: "b" });
    const before = selects();
    const first = await s.all("task");
    await s.all("task");
    await s.all("task");
    expect(selects() - before).toBe(1);
    expect(first.map((r) => r.title)).toEqual(["a", "b"]);
    // Two reads in flight at once are one statement too.
    const two = await Promise.all([s.all("note"), s.all("note")]);
    expect(two).toEqual([[], []]);
    expect(selects() - before).toBe(2);
  });

  it("hands out a clone each time, so a caller changing a row changes nothing", async () => {
    const { store: s } = await counted();
    await s.insert("task", { title: "a" });
    const one = await s.all("task");
    one[0]!.title = "changed";
    const again = await s.all("task");
    expect(again[0]!.title).toBe("a");
    expect(again[0]).not.toBe(one[0]);
  });

  it("forgets an entity on its insert, update and delete, and only that entity", async () => {
    const { store: s, selects } = await counted();
    const r = await s.insert("task", { title: "a" });
    await s.insert("note", { body: "n" });
    await s.all("task");
    await s.all("note");
    const before = selects();
    await s.update("task", r.id, { title: "b" });
    expect((await s.all("task")).map((t) => t.title)).toEqual(["b"]);
    await s.all("note");
    expect(selects() - before).toBe(1); // task again; note as before
    await s.delete("task", r.id);
    expect(await s.all("task")).toEqual([]);
    await s.insert("task", { title: "c" });
    expect((await s.all("task")).map((t) => t.title)).toEqual(["c"]);
  });

  it("reads a set of ids once too, and forgets it with the entity", async () => {
    const { store: s, selects } = await counted();
    const a = await s.insert("aisle", { name: "dairy" });
    const b = await s.insert("aisle", { name: "bread" });
    const before = selects();
    await s.all("aisle", { ids: [a.id, b.id] });
    await s.all("aisle", { ids: [b.id, a.id] });
    expect(selects() - before).toBe(1);
    await s.update("aisle", a.id, { name: "milk" });
    expect((await s.all("aisle", { ids: [a.id] }))[0]!.name).toBe("milk");
  });

  it("a listener told of a change reads the change, not what was read before", async () => {
    const { store: s } = await counted();
    await s.all("task");
    let seen: string[] = [];
    s.subscribe("task", () => void s.all("task").then((rows) => (seen = rows.map((r) => String(r.title)))));
    await s.insert("task", { title: "new" });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["new"]);
  });

  it("trusts nothing read before a transaction, and reads afresh after it", async () => {
    const { store: s, selects } = await counted();
    await s.insert("task", { title: "a" });
    await s.all("task");
    await s.transaction(async (tx) => {
      await tx.insert("task", { title: "b" });
      expect((await tx.all("task")).map((t) => t.title)).toEqual(["a", "b"]);
    });
    expect((await s.all("task")).map((t) => t.title)).toEqual(["a", "b"]);
    await s.transaction(async (tx) => {
      await tx.insert("task", { title: "c" });
      throw new Error("no");
    }).catch(() => undefined);
    const before = selects();
    expect((await s.all("task")).map((t) => t.title)).toEqual(["a", "b"]);
    expect(selects() - before).toBe(1);
  });
});
