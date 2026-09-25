// Leaving an app waits for the writes it started.
//
// A tick is a patch, and a patch is several store calls in turn — read the record, check the values
// fit, write. Going home put the app away between those calls: the store closed, the write landed on
// a closed database, and the tick was gone on the next open. `settle()` is what the shell awaits
// before closing the store, so these pin that it covers every way a write starts.

import { describe, expect, it } from "vitest";
import { defineApp } from "karta";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@karta/host";
import { createRuntime } from "../src/index.js";

const app = defineApp({
  id: "list",
  name: "List",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      fields: { name: { type: "text" }, bought: { type: "boolean" } },
      actions: {
        buy: async (r: { id: string }, ctx: { patch: (e: string, id: string, d: object) => Promise<unknown> }) => {
          await ctx.patch("item", r.id, { bought: true });
        },
      },
    },
  },
  pages: [{ id: "items", title: "Items", view: { type: "list", entity: "item" } }],
} as never);

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

/** A store whose writes take a while to land — as they do across a worker. */
class SlowStore extends MemoryStore {
  override async update(entity: string, id: string, patch: object) {
    await new Promise((r) => setTimeout(r, 30));
    return super.update(entity, id, patch as never);
  }
}

async function setup() {
  const store = new SlowStore();
  await store.open("list");
  const milk = await store.insert("item", { name: "Milk", bought: false });
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app as never, provenance: "trusted" });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
  return { runtime, store, id: String(milk.id) };
}

describe("settle", () => {
  it("waits for a patch that is still on its way", async () => {
    const { runtime, store, id } = await setup();
    void runtime.patch("item", id, { bought: true });
    await runtime.settle();
    expect((await store.get("item", id))!.bought).toBe(true);
  });

  it("waits for a write made through ctx, as a custom view makes it", async () => {
    const { runtime, store, id } = await setup();
    void runtime.ctx.patch("item", id, { bought: true });
    await runtime.settle();
    expect((await store.get("item", id))!.bought).toBe(true);
  });

  it("waits for an action, including the writes inside it", async () => {
    const { runtime, store, id } = await setup();
    void runtime.runAction("item", "buy", id);
    await runtime.settle();
    expect((await store.get("item", id))!.bought).toBe(true);
  });

  it("does not wait on a failed write, and does not throw it", async () => {
    const { runtime } = await setup();
    const failing = runtime.patch("item", "no-such-id", { bought: true });
    await expect(runtime.settle()).resolves.toBeUndefined();
    await expect(failing).rejects.toThrow();
  });

  it("returns at once when nothing is on its way", async () => {
    const { runtime } = await setup();
    await expect(runtime.settle()).resolves.toBeUndefined();
  });
});
