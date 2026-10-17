import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/index.js";

async function seeded(): Promise<MemoryStore> {
  const s = new MemoryStore();
  await s.open("test");
  return s;
}

describe("MemoryStore CRUD", () => {
  it("inserts with generated id + timestamps and reads back a clone", async () => {
    const s = await seeded();
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
    const s = await seeded();
    const r = await s.insert("task", { title: "a" });
    await new Promise((res) => setTimeout(res, 2));
    const u = await s.update("task", r.id, { title: "b" });
    expect(u.id).toBe(r.id);
    expect(u.createdAt).toBe(r.createdAt);
    expect(u.title).toBe("b");
  });

  it("all() returns rows in creation order and supports narrowing", async () => {
    const s = await seeded();
    const a = await s.insert("task", { title: "a" });
    const b = await s.insert("task", { title: "b" });
    const rows = await s.all("task");
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
    expect((await s.all("task", { limit: 1 })).length).toBe(1);
    expect((await s.all("task", { ids: [b.id] })).map((r) => r.title)).toEqual(["b"]);
  });

  it("delete removes the record", async () => {
    const s = await seeded();
    const r = await s.insert("task", { title: "a" });
    await s.delete("task", r.id);
    expect(await s.get("task", r.id)).toBeNull();
  });
});

describe("MemoryStore reactivity", () => {
  it("notifies subscribers on writes to that entity", async () => {
    const s = await seeded();
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

describe("MemoryStore transactions", () => {
  it("rolls back on throw", async () => {
    const s = await seeded();
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

describe("MemoryStore blobs + kv", () => {
  it("round-trips a blob", async () => {
    const s = await seeded();
    const ref = await s.putBlob(new Blob(["hello"], { type: "text/plain" }));
    const back = await s.getBlob(ref);
    expect(await back!.text()).toBe("hello");
  });

  it("round-trips kv", async () => {
    const s = await seeded();
    await s.kvSet("k", "v");
    expect(await s.kvGet("k")).toBe("v");
    await s.kvDelete("k");
    expect(await s.kvGet("k")).toBeNull();
  });
});

describe("MemoryStore migrations", () => {

  it("addRecord makes the record existing ones are pointed at, once", async () => {
    const s = await seeded();
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
    const s = await seeded();
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
