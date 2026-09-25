// A computed that throws must not take the page with it (the PPL Log report: delete an exercise that
// past sessions still mention, and Program sat on "Loading…" forever, with nothing on screen or in
// the console). App code meets data it did not expect — a relation to a deleted record resolves to
// null — so one row's failing computed is contained to that row and said out loud; and a page whose
// query still fails says so instead of loading forever.

import { describe, expect, it, vi } from "vitest";
import { defineApp } from "karta";
import workout from "../../../examples/workout.app.js";
import { MemoryStore } from "@karta/store";
import { FakeCapabilities } from "@karta/capabilities";
import { createHost } from "@karta/host";
import { createRuntime, watchPageQuery, type QueryState } from "../src/index.js";

const ui = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };

async function harness(app: unknown, id: string) {
  const store = new MemoryStore();
  await store.open(id);
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app as never });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav: { navigate: () => {} } });
  return { store, runtime };
}

describe("a computed that throws", () => {
  it("leaves that value empty, keeps the rows, and warns once", async () => {
    const app = defineApp({
      id: "t",
      name: "T",
      version: "1.0.0",
      schemaVersion: 1,
      entities: { item: { displayField: "name", fields: { name: { type: "text" } }, computed: { shout: (r) => (r.name === "bad" ? (null as never as { x: string }).x : String(r.name).toUpperCase()) } } },
      pages: [{ id: "all", title: "All", view: { type: "list", entity: "item" } }],
    } as never);
    const { store, runtime } = await harness(app, "t");
    await store.insert("item", { name: "good" });
    await store.insert("item", { name: "bad" });
    await store.insert("item", { name: "bad" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rows } = await runtime.queryPage("all");
    expect(rows.map((r) => [r.name, r.shout])).toEqual([
      ["good", "GOOD"],
      ["bad", undefined],
      ["bad", undefined],
    ]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("item.shout"))).toHaveLength(1);
    warn.mockRestore();
  });

  it("PPL Log: deleting an exercise past sessions mention leaves Program readable", async () => {
    const { store, runtime } = await harness(workout, "workout");
    const bench = await store.insert("exercise", { name: "Bench Press", day: "push", order: 0 });
    const ohp = await store.insert("exercise", { name: "OHP", day: "push", order: 1 });
    await store.insert("session", { day: "push", date: new Date(), entries: [{ exercise: bench.id, sets: [{ kg: 60, reps: 8 }] }, { exercise: ohp.id, sets: [{ kg: 40, reps: 8 }] }] });
    await runtime.remove("exercise", bench.id);
    const { rows } = await runtime.queryPage("program");
    expect(rows.map((r) => r.name)).toEqual(["OHP"]);
    expect(rows[0]!.lastBest).toMatchObject({ kg: 40, reps: 8 });
  });
});

describe("a page whose query fails", () => {
  it("stops loading and says why, instead of loading forever", async () => {
    const app = defineApp({
      id: "c",
      name: "C",
      version: "1.0.0",
      schemaVersion: 1,
      entities: { node: { fields: { n: { type: "number" } }, computed: { self: async (_r, ctx) => (await ctx.query("node")).reduce((a: number, o: { self?: number }) => a + (o.self ?? 0), 0) } } },
      pages: [{ id: "nodes", title: "N", view: { type: "list", entity: "node" } }],
    } as never);
    const { store, runtime } = await harness(app, "c");
    await store.insert("node", { n: 1 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const states: QueryState[] = [];
    const stop = watchPageQuery(runtime.core, "nodes", undefined, (s) => states.push(s));
    await vi.waitFor(() => expect(states.length).toBeGreaterThan(0));
    stop();
    expect(states.at(-1)).toMatchObject({ rows: [], loading: false, error: expect.stringMatching(/Computed cycle/) });
  });
});
