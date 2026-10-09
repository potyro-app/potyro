// The runtime tells the store what the app declared (KA-38).
//
// Small, and load-bearing. `Store.open` takes an id and nothing else, so until this call existed a
// CRDT store held a `tags` field without knowing it was a set — which is why the schema could name
// the right merge behaviour while the store went on doing last-write-wins. If this stops firing,
// nothing throws and no test about tags fails locally; the loss only appears when two people edit
// at once, which is exactly the failure mode that made KA-38 expensive. So it is pinned here.

import { describe, expect, it } from "vitest";
import { defineApp } from "potyro";
import type { StoreSchema } from "@potyro/store";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime } from "../src/index.js";

const app = defineApp({
  id: "notes",
  name: "Notes",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    note: {
      fields: { title: { type: "text" }, tags: { type: "tags" } },
      computed: { shouty: () => "!" },
      actions: { archive: () => {} },
    },
  },
  pages: [{ id: "notes", title: "Notes", view: { type: "list", entity: "note" } }],
} as never);

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

async function describedBy(store: MemoryStore & { described?: StoreSchema[] }): Promise<StoreSchema[]> {
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app as never, provenance: "trusted" });
  createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
  return store.described ?? [];
}

function spyStore(): MemoryStore & { described: StoreSchema[] } {
  const store = new MemoryStore() as MemoryStore & { described: StoreSchema[] };
  store.described = [];
  (store as { describe?: (s: StoreSchema) => void }).describe = (s) => void store.described.push(s);
  return store;
}

describe("createRuntime describes the store", () => {
  it("hands over every entity's declared fields", async () => {
    const store = spyStore();
    await store.open("notes");
    const calls = await describedBy(store);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.note!.tags).toEqual({ type: "tags" });
    expect(calls[0]!.note!.title).toEqual({ type: "text" });
  });

  it("hands over the fields and NOTHING else", async () => {
    // Computed and actions are functions. A seam that carried them would be inviting whatever is on
    // the other side of it to call them — and on the untrusted path the other side is the isolate
    // boundary, which is the one place app code must not be reachable from.
    const store = spyStore();
    await store.open("notes");
    const [schema] = await describedBy(store);

    expect(Object.keys(schema!)).toEqual(["note"]);
    expect(Object.keys(schema!.note!).sort()).toEqual(["tags", "title"]);
    for (const field of Object.values(schema!.note!)) {
      expect(typeof field).toBe("object");
    }
  });

  it("is optional — a store without it still runs", async () => {
    // MemoryStore and SqliteStore hold one current value per field and have nothing to do with any
    // of this. They must not be forced to implement a method they cannot honour.
    const store = new MemoryStore();
    await store.open("notes");
    expect(store.describe).toBeUndefined();
    await expect(describedBy(store)).resolves.toEqual([]);
  });
});
