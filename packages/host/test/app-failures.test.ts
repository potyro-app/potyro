// A computed that throws shows as empty, and its page still loads — and whoever checks the app hears
// about it every time, not once per session like the console (#262).

import { describe, expect, it, vi } from "vitest";
import { defineApp, type PotyroApp } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, onAppFailure, type AppFailure, type MakeCtxBase } from "../src/index.js";

function mealsApp(): PotyroApp {
  return defineApp({
    id: "meals-failing",
    name: "Meals",
    version: "1.0.0",
    schemaVersion: 1,
    entities: {
      meal: {
        displayField: "name",
        fields: { name: { type: "text" } },
        computed: {
          kcal: (_r: unknown, ctx: unknown) => (ctx as { nutrition: { lookup(): number } }).nutrition.lookup(),
        },
      },
    },
    pages: [],
  } as never);
}

async function query(): Promise<unknown[]> {
  const store = new MemoryStore();
  await store.open("meals-failing");
  await store.insert("meal", { name: "Soup" });
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: mealsApp() });
  const base: MakeCtxBase = {
    store,
    caps: new FakeCapabilities(),
    ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null },
    nav: { navigate: () => {} },
  };
  return host.makeCtx(loaded, base).query("meal");
}

describe("contained app failures", () => {
  it("keeps the record, empties the value, and tells every listener — every time", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const heard: AppFailure[] = [];
    const stop = onAppFailure((f) => heard.push(f));
    try {
      const rows = (await query()) as Array<{ name: string; kcal?: unknown }>;
      expect(rows[0]!.name).toBe("Soup");
      expect(rows[0]!.kcal).toBeUndefined();
      await query(); // the console says it once per session; listeners hear the second run too
    } finally {
      stop();
    }
    expect(heard).toHaveLength(2);
    expect(heard[0]).toMatchObject({ app: "meals-failing", what: "computed meal.kcal" });
    expect(heard[0]!.message).toMatch(/lookup|undefined/);
  });

  it("stops telling a listener once it unsubscribes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const heard: AppFailure[] = [];
    onAppFailure((f) => heard.push(f))();
    await query();
    expect(heard).toEqual([]);
  });
});
