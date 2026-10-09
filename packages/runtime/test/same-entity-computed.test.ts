// A computed that queries its OWN entity — "time since the previous entry", "change from the last
// weigh-in", "rolling average". The generator eval showed this is the single most common shape the
// runtime could not express: `ctx.query` resolves every row (including the one being computed), so
// the record re-entered its own computed and the cycle guard threw.
//
// The distinction that matters is not HOW the key is re-entered (both cases go through a nested
// ctx.query) but whether the in-flight value is actually READ. Siblings that only read plain fields
// are legitimate; a computed that reads its own value is a genuine cycle and must still throw.

import { describe, expect, it } from "vitest";
import { defineApp, type AppDefinition } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "../src/index.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

async function harness(app: AppDefinition, appId: string): Promise<{ store: MemoryStore; runtime: PotyroRuntime }> {
  const store = new MemoryStore();
  await store.open(appId);
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app as never });
  return { store, runtime: createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav }) };
}

describe("computed querying its own entity", () => {
  it("resolves when siblings are read for their plain fields only", async () => {
    const app = defineApp({
      id: "feeds",
      name: "Feeds",
      version: "1.0.0",
      schemaVersion: 1,
      entities: {
        feed: {
          fields: { at: { type: "datetime" } },
          computed: {
            // Reads sibling `at` (a plain field) — never a sibling's computed.
            gapBefore: async (f, ctx) => {
              const earlier = (await ctx.query("feed")).filter(
                (r) => new Date(r.at as Date).getTime() < new Date(f.at as Date).getTime(),
              );
              if (!earlier.length) return -1;
              const prev = earlier.sort(
                (a, b) => new Date(b.at as Date).getTime() - new Date(a.at as Date).getTime(),
              )[0]!;
              return new Date(f.at as Date).getTime() - new Date(prev.at as Date).getTime();
            },
          },
        },
      },
      pages: [{ id: "feeds", title: "Feeds", view: { type: "list", entity: "feed" } }],
    });

    const { store, runtime } = await harness(app as never, "feeds");
    await store.insert("feed", { at: new Date("2026-07-20T10:00:00Z") });
    await store.insert("feed", { at: new Date("2026-07-20T13:00:00Z") });

    const { rows } = await runtime.queryPage("feeds");
    const gaps = rows.map((r) => r.gapBefore).sort((a, b) => Number(a) - Number(b));
    expect(gaps).toEqual([-1, 3 * 60 * 60 * 1000]); // first feed, then a 3-hour gap
  });

  it("still resolves a parent computed that aggregates a child's computed", async () => {
    const app = defineApp({
      id: "billing",
      name: "Billing",
      version: "1.0.0",
      schemaVersion: 1,
      entities: {
        entry: {
          fields: { hours: { type: "number" }, rate: { type: "number" } },
          computed: { amount: (e) => Number(e.hours) * Number(e.rate) },
        },
        client: {
          fields: { name: { type: "text" } },
          // Reads a DIFFERENT entity's computed — must keep working, not silently yield 0.
          computed: {
            total: async (_c, ctx) =>
              (await ctx.query("entry")).reduce((sum: number, e) => sum + Number(e.amount), 0),
          },
        },
      },
      pages: [{ id: "clients", title: "Clients", view: { type: "list", entity: "client" } }],
    });

    const { store, runtime } = await harness(app as never, "billing");
    await store.insert("entry", { hours: 3, rate: 100 });
    await store.insert("entry", { hours: 2, rate: 50 });
    await store.insert("client", { name: "Acme" });

    const { rows } = await runtime.queryPage("clients");
    expect(rows[0]!.total).toBe(400);
  });

  it("still throws when a computed genuinely reads its own value", async () => {
    const app = defineApp({
      id: "cycle2",
      name: "Cycle",
      version: "1.0.0",
      schemaVersion: 1,
      entities: {
        node: {
          fields: { n: { type: "number" } },
          computed: {
            self: async (_r, ctx) =>
              (await ctx.query("node")).reduce((a: number, o) => a + (Number(o.self) || 0), 0),
          },
        },
      },
      pages: [{ id: "nodes", title: "N", view: { type: "list", entity: "node" } }],
    });

    const { store, runtime } = await harness(app as never, "cycle2");
    await store.insert("node", { n: 1 });
    await expect(runtime.queryPage("nodes")).rejects.toThrow(/Computed cycle/);
  });
});
