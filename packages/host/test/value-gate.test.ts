// Values that do not fit their field go no further (KA-21, #62).
//
// Write: refused, on the direct ctx and across the isolate alike — the isolate is where an app
// shared with you runs, so it is the path that most needs it.
// Read: a value some copy should never have written is not shown; the record keeps the last value
// that did fit, and says nothing about it.

import { describe, expect, it } from "vitest";
import { MemoryStore, type FieldEdit } from "@potyro/store";
import { defineApp } from "potyro";
import type { NavBridge, UiBridge } from "@potyro/host";
import { FakeCapabilities } from "@potyro/capabilities";
import { newAsyncContext } from "quickjs-emscripten";
import { createHost, type MakeCtxBase } from "../src/index.js";
import { createIsolateLoader, type QuickJSAsyncContextLike } from "../src/isolate/index.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };
const ana = { id: "co_zAna", name: "Ana" };

const trip = () =>
  defineApp({
    id: "trip",
    name: "Trip",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      expense: {
        label: "Expense",
        displayField: "description",
        fields: {
          description: { type: "text", required: true },
          amount: { type: "number", label: "Amount", min: 0 },
          status: { type: "enum", options: ["open", "settled"] },
        },
      },
    },
    pages: [{ id: "all", title: "All", view: { type: "list", entity: "expense", display: { primary: "description" } } }],
  });

/** A store that remembers every value each field ever held, the way a CRDT store's log does. */
class HistoryStore extends MemoryStore {
  edits: Array<FieldEdit & { entity: string; id: string }> = [];
  async editHistory(entity: string, id: string): Promise<FieldEdit[]> {
    return this.edits.filter((e) => e.entity === entity && e.id === id);
  }
}

async function direct(store: MemoryStore = new MemoryStore()) {
  await store.open("trip");
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: trip() });
  const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui, nav, me: ana } as MakeCtxBase);
  return { ctx, store };
}

describe("writing a value that does not fit", () => {
  it("is refused on create, patch and increment, and nothing is stored", async () => {
    const { ctx, store } = await direct();
    await expect(ctx.create("expense", { description: "Taxi", amount: "twelve" })).rejects.toThrow("Amount must be a number.");
    expect(await store.all("expense")).toEqual([]);

    const taxi = await ctx.create("expense", { description: "Taxi", amount: 18, status: "open" });
    await expect(ctx.patch("expense", taxi.id, { amount: -5 })).rejects.toThrow("Amount must be at least 0.");
    await expect(ctx.patch("expense", taxi.id, { status: "hacked" })).rejects.toThrow(/Status must be one of/);
    await expect(ctx.increment("expense", taxi.id, "description", 1)).rejects.toThrow(/cannot be counted/);
    const after = await store.get("expense", taxi.id);
    expect([after?.amount, after?.status, after?.description]).toEqual([18, "open", "Taxi"]);
  });

  it("does not block saving a record because of a value nobody changed", async () => {
    // The edit form sends every field back. An option renamed since this record was written must not
    // make the record impossible to save for an edit to something else.
    const { ctx, store } = await direct();
    const row = await store.insert("expense", { description: "Taxi", amount: 18, status: "pending" } as never);
    await ctx.patch("expense", row.id, { description: "Taxi to the airport", amount: 18, status: "pending" });
    expect((await store.get("expense", row.id))?.description).toBe("Taxi to the airport");
    // Changing it TO something unfit is still refused.
    await expect(ctx.patch("expense", row.id, { status: "also-not-an-option" })).rejects.toThrow(/Status must be one of/);
  });
});

describe("reading a value that does not fit", () => {
  it("shows the last value that fit, silently", async () => {
    const store = new HistoryStore();
    const { ctx } = await direct(store);
    // Some other copy wrote "twelve" over 18 — the store holds it; the history shows both.
    const row = await store.insert("expense", { description: "Taxi", amount: "twelve" } as never);
    store.edits.push(
      { entity: "expense", id: row.id, field: "amount", value: 18, by: "co_zBo", at: new Date("2026-09-14T10:00:00Z") },
      { entity: "expense", id: row.id, field: "amount", value: "twelve", by: "co_zBo", at: new Date("2026-09-14T11:00:00Z") },
    );

    expect((await ctx.get("expense", row.id))?.amount).toBe(18);
    expect((await ctx.query("expense")).map((r) => r.amount)).toEqual([18]);
  });

  it("shows nothing for it on a store that keeps no history", async () => {
    const { ctx, store } = await direct();
    const row = await store.insert("expense", { description: "Taxi", amount: { $gt: 0 } } as never);
    const got = await ctx.get("expense", row.id);
    expect(got?.description).toBe("Taxi");
    expect(got?.amount).toBeUndefined();
  });

  it("keeps an enum value whose option has since been renamed", async () => {
    const { ctx, store } = await direct();
    const row = await store.insert("expense", { description: "Taxi", status: "pending" } as never);
    expect((await ctx.get("expense", row.id))?.status).toBe("pending");
  });
});

// The same, from inside the isolate: the path an app shared with you takes.
const BUNDLE = `
globalThis.__potyroApp = {
  id: "trip", name: "Trip", version: "1.0.0", schemaVersion: 1,
  entities: { expense: { fields: { description: { type: "text" }, amount: { type: "number", label: "Amount" } }, actions: {
    writeBad: async function(r, ctx){ await ctx.create("expense", { description: "Taxi", amount: "twelve" }); },
    patchBad: async function(r, ctx){ await ctx.patch("expense", r.id, { amount: { $ne: null } }); },
    readIt: async function(r, ctx){ var got = await ctx.get("expense", r.id); ctx.ui.toast("amount=" + JSON.stringify(got.amount)); }
  } } },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "expense" } }],
  reminders: []
};
`;

describe("across the isolate", () => {
  async function isolated() {
    const store = new MemoryStore();
    await store.open("trip");
    const toasts: string[] = [];
    const loadIsolated = createIsolateLoader({ store, newContext: () => newAsyncContext() as unknown as Promise<QuickJSAsyncContextLike> });
    const host = createHost({ loadIsolated });
    const loaded = await host.load({ kind: "bundle", code: BUNDLE, provenance: "untrusted" });
    const ctx = host.makeCtx(loaded, { store, caps: new FakeCapabilities(), ui: { ...ui, toast: (m) => void toasts.push(m) }, nav, params: {}, me: ana } as MakeCtxBase);
    return { store, loaded, ctx, toasts };
  }

  it("refuses to store a value that does not fit", async () => {
    const { store, loaded, ctx } = await isolated();
    await expect(loaded.callAction("expense", "writeBad", { id: "x" } as never, ctx)).rejects.toThrow(/Amount must be a number/);
    const row = await store.insert("expense", { description: "Taxi", amount: 18 } as never);
    await expect(loaded.callAction("expense", "patchBad", { ...row } as never, ctx)).rejects.toThrow(/Amount must be a number/);
    expect(await store.all("expense")).toHaveLength(1);
    expect((await store.get("expense", row.id))?.amount).toBe(18);
    loaded.dispose();
  });

  it("does not hand app code a value that does not fit", async () => {
    const { store, loaded, ctx, toasts } = await isolated();
    const row = await store.insert("expense", { description: "Taxi", amount: "twelve" } as never);
    await loaded.callAction("expense", "readIt", { ...row } as never, ctx);
    expect(toasts).toEqual(["amount=undefined"]);
    loaded.dispose();
  });
});
