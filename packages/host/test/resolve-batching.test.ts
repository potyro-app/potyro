// Resolving a list reads each related record once, not once per row.
//
// 5,000 items pointing at 5 aisles used to cost 5,000 `store.get` calls — each a round trip to the
// storage worker, waited for in turn — for the same 5 aisles. That was 2 seconds of a 2-second
// query; reading the items themselves took 21 ms. These pin the batching by COUNTING store calls,
// because the time depends on the machine and the count does not.

import { describe, expect, it } from "vitest";
import { defineApp, type PotyroApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type MakeCtxBase } from "../src/index.js";

function shopApp(): PotyroApp {
  return defineApp({
    id: "shop",
    name: "Shop",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      aisle: { displayField: "name", fields: { name: { type: "text" } } },
      tag: { displayField: "name", fields: { name: { type: "text" } } },
      item: {
        displayField: "name",
        fields: {
          name: { type: "text" },
          aisle: { type: "relation", to: "aisle" },
          tags: { type: "relation", to: "tag", many: true },
          parts: { type: "list", of: { tag: { type: "relation", to: "tag" } } },
        },
      },
    },
    pages: [],
  });
}

/** A MemoryStore that counts how it is read. */
class CountingStore extends MemoryStore {
  gets = 0;
  alls: Array<{ entity: string; ids?: number }> = [];
  override async get(entity: string, id: string) {
    this.gets++;
    return super.get(entity, id);
  }
  override async all(entity: string, narrow?: { ids?: string[] }) {
    this.alls.push({ entity, ...(narrow?.ids ? { ids: narrow.ids.length } : {}) });
    return super.all(entity, narrow);
  }
  reset(): void {
    this.gets = 0;
    this.alls = [];
  }
}

async function setup(items: number) {
  const store = new CountingStore();
  await store.open("shop");
  const aisles = [];
  for (let i = 0; i < 5; i++) aisles.push(await store.insert("aisle", { name: `Aisle ${i}` }));
  const tags = [];
  for (let i = 0; i < 3; i++) tags.push(await store.insert("tag", { name: `Tag ${i}` }));
  for (let i = 0; i < items; i++) {
    await store.insert("item", {
      name: `Item ${i}`,
      aisle: aisles[i % 5]!.id,
      tags: [tags[i % 3]!.id, tags[(i + 1) % 3]!.id],
      parts: [{ tag: tags[i % 3]!.id }],
    });
  }
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: shopApp() });
  const base: MakeCtxBase = {
    store,
    caps: new FakeCapabilities(),
    ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
    nav: { navigate: () => {} },
  };
  store.reset();
  return { ctx: host.makeCtx(loaded, base), store, aisles, tags };
}

describe("resolving a list", () => {
  it("fetches each kind of related record in one batch, whatever the number of rows", async () => {
    const { ctx, store } = await setup(200);
    const rows = await ctx.query("item");

    expect(rows).toHaveLength(200);
    // One read for the items, one batch per related kind — not one read per row per relation.
    expect(store.gets).toBe(0);
    expect(store.alls).toEqual([{ entity: "item" }, { entity: "aisle", ids: 5 }, { entity: "tag", ids: 3 }]);
  });

  it("resolves exactly what one-at-a-time resolution did", async () => {
    const { ctx, aisles, tags } = await setup(7);
    const rows = await ctx.query("item");
    const third = rows[2]!;
    expect((third.aisle as { id: string; name: string }).name).toBe(aisles[2]!.name);
    expect((third.tags as Array<{ name: string }>).map((t) => t.name)).toEqual([tags[2]!.name, tags[0]!.name]);
    // A relation inside a list row is resolved too — from the same pass's reads.
    expect(((third.parts as Array<{ tag: { name: string } }>)[0]!.tag).name).toBe(tags[2]!.name);
  });

  it("a record that no longer exists still resolves to null", async () => {
    const { ctx, store, aisles } = await setup(5);
    await store.delete("aisle", aisles[1]!.id);
    const rows = await ctx.query("item");
    expect(rows[1]!.aisle).toBeNull();
    expect((rows[0]!.aisle as { name: string }).name).toBe(aisles[0]!.name);
  });

  it("sees a write made in the same pass", async () => {
    const { ctx, aisles } = await setup(3);
    await ctx.query("item");
    await ctx.patch("aisle", aisles[0]!.id, { name: "Renamed" });
    const rows = await ctx.query("item");
    expect((rows[0]!.aisle as { name: string }).name).toBe("Renamed");
  });
});
