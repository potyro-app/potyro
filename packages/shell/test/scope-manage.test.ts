// Duplicating and deleting an app-wide selection (a list, a trip) with what belongs to it — the shell
// does it from the app's shape, so every app that works on one list at a time gets it.

import { describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost } from "@potyro/host";
import { createRuntime } from "@potyro/runtime";
import { defineApp, type PotyroApp } from "potyro";
import { contentsOf, deleteScope, duplicateScope, ownedBy } from "../src/scope-manage.js";

const app = defineApp({
  id: "shop",
  name: "Shop",
  version: "1.0.0",
  schemaVersion: 1,
  scope: { entity: "list", required: true },
  entities: {
    list: { displayField: "name", fields: { name: { type: "text", required: true } } },
    aisle: { displayField: "name", fields: { name: { type: "text" } } },
    item: {
      displayField: "name",
      fields: {
        name: { type: "text" },
        list: { type: "relation", to: "list" },
        aisle: { type: "relation", to: "aisle" },
        bought: { type: "boolean" },
        // An item can name another item on the same list ("instead of"), to show relations inside a
        // copy follow the copy.
        instead: { type: "relation", to: "item" },
      },
    },
  },
  pages: [{ id: "list", title: "List", view: { type: "checklist", entity: "item", done: "bought" } }],
}) as PotyroApp;

async function rig() {
  const store = new MemoryStore();
  await store.open("shop");
  const host = createHost();
  const loaded = await host.load({ kind: "module", app, provenance: "trusted" });
  const ui = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });
  const weekly = await store.insert("list", { name: "Weekly shop" });
  const party = await store.insert("list", { name: "Party" });
  const dairy = await store.insert("aisle", { name: "Dairy" });
  const milk = await store.insert("item", { name: "Milk", list: weekly.id, aisle: dairy.id, bought: true });
  await store.insert("item", { name: "Oat drink", list: weekly.id, aisle: dairy.id, bought: false, instead: milk.id });
  await store.insert("item", { name: "Crisps", list: party.id, bought: false });
  return { store, runtime, weekly, party, dairy };
}

describe("a scope's contents", () => {
  it("are the records whose single relation points at it", async () => {
    const { runtime, weekly } = await rig();
    expect(ownedBy(runtime, "list")).toEqual([{ entity: "item", field: "list" }]);
    const contents = await contentsOf(runtime, "list", String(weekly.id));
    expect(contents.map((c) => [c.entity, c.rows.map((r) => r.name)])).toEqual([["item", ["Milk", "Oat drink"]]]);
  });
});

describe("duplicateScope", () => {
  it("copies the list and its items, under the new name, leaving the original as it was", async () => {
    const { store, runtime, weekly, dairy } = await rig();
    const copyId = await duplicateScope(runtime, "list", String(weekly.id), "Weekly shop (copy)");
    expect((await store.get("list", copyId))!.name).toBe("Weekly shop (copy)");
    const copied = (await store.all("item")).filter((i) => i.list === copyId);
    expect(copied.map((i) => [i.name, i.bought, i.aisle])).toEqual([
      ["Milk", true, dairy.id],
      ["Oat drink", false, dairy.id],
    ]);
    // A relation between two copied records points at the copy, not the original.
    const copiedMilk = copied.find((i) => i.name === "Milk")!;
    expect(copied.find((i) => i.name === "Oat drink")!.instead).toBe(copiedMilk.id);
    expect((await store.all("item")).filter((i) => i.list === weekly.id)).toHaveLength(2);
  });
});

describe("deleteScope", () => {
  it("deletes the list and only its own items", async () => {
    const { store, runtime, weekly, party } = await rig();
    await deleteScope(runtime, "list", String(weekly.id));
    expect((await store.all("list")).map((l) => l.id)).toEqual([party.id]);
    expect((await store.all("item")).map((i) => i.name)).toEqual(["Crisps"]);
    // Aisles are not the list's: they stay.
    expect(await store.all("aisle")).toHaveLength(1);
  });
});
