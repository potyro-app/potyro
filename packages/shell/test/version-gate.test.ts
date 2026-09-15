// The KA-22 version gate (#63): the lockable store, and asking before shared data changes shape.
//
// The two-device path — a newer version published while an old copy is open — is the e2e spec
// `app-version-gate-trusted.spec.ts`; these pin the pieces it is built from.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDefinition, Migration } from "karta";
import { MemoryStore } from "@karta/store";
import { AppLock } from "../src/app-lock.js";
import { SchemaBehindError, guardedStore } from "../src/read-only-store.js";
import { migrateShared, type GateResult } from "../src/version-gate.js";
import { shellDialogs } from "../src/dialog.js";

const ADD_DONE: Migration = { from: "1.0.0", to: "2.0.0", steps: [{ op: "addField", entity: "item", field: "done", default: false }] };
const v2 = { id: "todo", name: "Shared Todo", version: "2.0.0", schemaVersion: 2, entities: {}, pages: [], migrations: [ADD_DONE] } as unknown as AppDefinition;

async function oldData(): Promise<MemoryStore> {
  const s = new MemoryStore();
  await s.open("todo");
  await s.insert("item", { title: "milk" });
  await s.kvSet("__appVersion", "1.0.0");
  return s;
}

const gate: GateResult = { proceed: true, recordVersion: true, published: Promise.resolve(), stop: () => {} };

const realConfirm = shellDialogs.confirm;
afterEach(() => {
  shellDialogs.confirm = realConfirm;
});

describe("a store guarded by a lock", () => {
  it("writes while unlocked, refuses while locked, and writes again once unlocked", async () => {
    const lock = new AppLock();
    const s = guardedStore(await oldData(), lock.refusal);

    await s.insert("item", { title: "eggs" });

    lock.set({ kind: "version", resolve: async () => {} });
    await expect(s.insert("item", { title: "bread" })).rejects.toBeInstanceOf(SchemaBehindError);
    await expect(s.kvSet("k", "v")).rejects.toThrow(/newer version/);
    // Reads keep working: a locked app is readable, not blank.
    expect((await s.all("item")).map((r) => r.title)).toEqual(["milk", "eggs"]);

    lock.set(null);
    await s.insert("item", { title: "bread" });
    expect(await s.all("item")).toHaveLength(3);
  });
});

describe("the guarded store is a drop-in", () => {
  it("forwards every method the store it wraps has — a missing one silently loses a feature", () => {
    // A Store with EVERY optional member present, so a method the wrapper forgets shows up here
    // rather than as a shared app that quietly stops merging tags.
    const methods = [
      "open", "close", "describe", "all", "get", "byIndex", "insert", "update", "delete", "increment", "transaction",
      "subscribe", "putBlob", "putBlobWithKey", "getBlob", "kvGet", "kvSet", "kvDelete", "kvKeys", "subscribeKv", "memberIds",
      "storedSchemaVersion", "runMigrations", "editHistory", "postMessage", "messages", "subscribeMessages",
    ];
    const full = Object.fromEntries(methods.map((m) => [m, vi.fn(async () => undefined)])) as unknown as import("@karta/store").Store;
    const guarded = guardedStore(full, () => null) as unknown as Record<string, unknown>;
    expect(methods.filter((m) => typeof guarded[m] !== "function")).toEqual([]);
  });
});

describe("changing shared data to a new version", () => {
  it("asks first when other people share the app, and 'not now' changes nothing", async () => {
    const raw = await oldData();
    const lock = new AppLock();
    const ask = vi.fn(async () => false);
    shellDialogs.confirm = ask;

    await migrateShared({ definition: v2, rawStore: raw, lock, gate, canWrite: true, others: ["Ana"], toast: { push: () => {} }, refresh: () => {} });

    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0]![0]).toContain("changes how “Shared Todo” stores its data");
    // Nothing migrated, and the app is read-only rather than writing v2 records into v1 data.
    expect((await raw.all("item"))[0]!.done).toBeUndefined();
    expect(await raw.kvGet("__appVersion")).toBe("1.0.0");
    expect(lock.get()?.kind).toBe("data");

    // The banner's "Update data" is the same change, taken later.
    await lock.get()!.resolve();
    expect((await raw.all("item"))[0]!.done).toBe(false);
    expect(lock.get()).toBeNull();
  });

  it("runs without asking when nobody else shares it", async () => {
    const raw = await oldData();
    const lock = new AppLock();
    const ask = vi.fn(async () => false);
    shellDialogs.confirm = ask;

    await migrateShared({ definition: v2, rawStore: raw, lock, gate, canWrite: true, others: [], toast: { push: () => {} }, refresh: () => {} });

    expect(ask).not.toHaveBeenCalled();
    expect((await raw.all("item"))[0]!.done).toBe(false);
  });

  it("a viewer never touches the data", async () => {
    const raw = await oldData();
    const ask = vi.fn(async () => true);
    shellDialogs.confirm = ask;

    await migrateShared({ definition: v2, rawStore: raw, lock: new AppLock(), gate, canWrite: false, others: ["Ana"], toast: { push: () => {} }, refresh: () => {} });

    expect(ask).not.toHaveBeenCalled();
    expect((await raw.all("item"))[0]!.done).toBeUndefined();
  });

  it("a migration that throws leaves the data as it was and the app read-only", async () => {
    const raw = await oldData();
    const lock = new AppLock();
    const broken = {
      ...v2,
      migrations: [{ from: "1.0.0", to: "2.0.0", steps: [{ op: "addField", entity: "item", field: "done", default: false }, { transform: () => { throw new Error("boom"); } }] }],
    } as unknown as AppDefinition;
    const toasts: string[] = [];

    await migrateShared({ definition: broken, rawStore: raw, lock, gate, canWrite: true, others: [], toast: { push: (m) => toasts.push(m) }, refresh: () => {} });

    expect(toasts[0]).toMatch(/Could not update your data: boom/);
    expect((await raw.all("item"))[0]!.done).toBeUndefined(); // not half-applied
    expect(lock.get()?.kind).toBe("data");
  });
});
