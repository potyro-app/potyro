// Nested lists + async computed (docs/08 workout fixture). Proves: nested list fields
// (session → entries → sets) round-trip through storage + resolution + sync computed; an async
// computed can call ctx.query (exercise.lastBest reads session history); computed are memoized
// per pass; and a genuinely self-referential computed is caught by the cycle guard.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { compileCatalog } from "@potyro/i18n/app-catalogs";
import workout from "../../../examples/workout.app.js";
import { computedInfo, defineApp, type AppDefinition, type EntityDef } from "potyro";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities } from "@potyro/capabilities";
import { createHost, type NavBridge, type UiBridge } from "@potyro/host";
import { createRuntime, type PotyroRuntime } from "../src/index.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
const nav: NavBridge = { navigate: () => {} };

async function harness(app: AppDefinition, appId = "workout"): Promise<{ store: MemoryStore; runtime: PotyroRuntime }> {
  const store = new MemoryStore();
  await store.open(appId);
  const host = createHost();
  const loaded = await host.load({ kind: "module", app: app as never });
  const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav });
  return { store, runtime };
}

describe("nested list fields (session → entries → sets)", () => {
  let store: MemoryStore;
  let runtime: PotyroRuntime;
  let benchId: string;

  beforeEach(async () => {
    ({ store, runtime } = await harness(workout));
    const bench = await store.insert("exercise", { name: "Bench Press", day: "push", bodyweight: false });
    benchId = bench.id;
    await store.insert("session", {
      day: "push",
      date: new Date("2026-07-20T10:00:00Z"),
      entries: [
        {
          exercise: bench.id,
          sets: [
            { kg: 60, reps: 10 },
            { kg: 70, reps: 8 },
            { kg: 80, reps: 5 },
          ],
        },
      ],
    });
  });

  it("resolves the nested list and computes over it", async () => {
    const { rows } = await runtime.queryPage("history");
    const s = rows[0]!;
    // relation inside a nested-list row is resolved one level
    expect(s.entries[0].exercise.name).toBe("Bench Press");
    // inner list is a real array
    expect(s.entries[0].sets).toHaveLength(3);
    // sync computed over the nested lists
    expect(s.totalSets).toBe(3);
    expect(s.totalVolume).toBe(60 * 10 + 70 * 8 + 80 * 5); // 600 + 560 + 400 = 1560
  });

  it("nested list survives a store round-trip", async () => {
    const raw = (await store.all("session"))[0]!;
    expect(Array.isArray(raw.entries)).toBe(true);
    expect((raw.entries as any[])[0].sets).toHaveLength(3);
    void benchId;
  });
});

describe("async computed that calls ctx.query (rolling personal best)", () => {
  it("scans session history to find the best set for an exercise", async () => {
    const { store, runtime } = await harness(workout);
    const squat = await store.insert("exercise", { name: "Squat", day: "legs", bodyweight: false });
    await store.insert("session", {
      day: "legs",
      date: new Date("2026-07-10T10:00:00Z"),
      entries: [{ exercise: squat.id, sets: [{ kg: 100, reps: 5 }] }],
    });
    await store.insert("session", {
      day: "legs",
      date: new Date("2026-07-18T10:00:00Z"),
      entries: [{ exercise: squat.id, sets: [{ kg: 120, reps: 3 }] }],
    });

    const { rows } = await runtime.queryPage("program#1") // the Program page's exercises (its routines come first);
    const ex = rows.find((r) => r.name === "Squat")!;
    // lastBest is async + queries history; best score across sets = max(100*5, 120*3) = 500
    expect(ex.lastBest).not.toBeNull();
    expect(ex.lastBest.kg).toBe(100);
    expect(ex.lastBest.reps).toBe(5);
    expect(ex.lastBest.score).toBe(500);
  });
});

describe("per-pass memoization", () => {
  it("evaluates a queried record's computed once even when several computeds read it", async () => {
    const computeCount = { tally: 0 };
    // Two exercises whose async computed both query all sessions; the sessions' `tally`
    // computed must run once per session across the whole pass.
    const app = defineApp({
      id: "memo",
      name: "Memo",
      version: "1.0.0",
      schemaVersion: 1,
      entities: {
        widget: {
          fields: { n: { type: "number" } },
          computed: {
            sumViaQuery: async (_w, ctx) => {
              const gs = await ctx.query("gadget");
              return gs.reduce((a: number, g: any) => a + g.tally, 0);
            },
          },
        },
        gadget: {
          fields: { v: { type: "number" } },
          computed: {
            tally: (g) => {
              computeCount.tally++;
              return g.v * 2;
            },
          },
        },
      },
      pages: [{ id: "widgets", title: "W", view: { type: "list", entity: "widget" } }],
    });

    const { store, runtime } = await harness(app as never, "memo");
    await store.insert("gadget", { v: 1 });
    await store.insert("gadget", { v: 2 });
    await store.insert("widget", { n: 0 });
    await store.insert("widget", { n: 0 });

    computeCount.tally = 0;
    const { rows } = await runtime.queryPage("widgets");
    // both widgets computed sumViaQuery = (1*2 + 2*2) = 6
    expect(rows.every((r) => r.sumViaQuery === 6)).toBe(true);
    // 2 gadgets → tally computed exactly twice for the whole pass, despite 2 widgets querying
    expect(computeCount.tally).toBe(2);
  });
});

describe("self-referential cycle guard", () => {
  it("throws a clear error when a computed depends on its own value", async () => {
    const app = defineApp({
      id: "cycle",
      name: "Cycle",
      version: "1.0.0",
      schemaVersion: 1,
      entities: {
        node: {
          fields: { n: { type: "number" } },
          computed: {
            // queries ALL nodes (including itself) and reads their `self` computed → cycle
            self: async (_r, ctx) => {
              const all = await ctx.query("node");
              return all.reduce((a: number, o: any) => a + (o.self ?? 0), 0);
            },
          },
        },
      },
      pages: [{ id: "nodes", title: "N", view: { type: "list", entity: "node" } }],
    });

    const { store, runtime } = await harness(app as never, "cycle");
    await store.insert("node", { n: 1 });
    await expect(runtime.queryPage("nodes")).rejects.toThrow(/Computed cycle/);
  });
});

const WORKOUT_CATALOGS = Object.fromEntries(
  readdirSync(new URL("../../../examples/files/workout/locales/", import.meta.url))
    .filter((f) => f.endsWith(".po"))
    .map((f) => [f.slice(0, -3), compileCatalog(readFileSync(new URL(`../../../examples/files/workout/locales/${f}`, import.meta.url), "utf8"))]),
);

describe("the rolling best reads as words", () => {
  // It is an object (the session view prefills from it); its `format` says it on the detail page.
  for (const [language, heavy, bodyweight] of [
    ["en", "82.5 kg × 8", "12 reps"],
    ["pl", "82,5 kg × 8", "12 powt."],
    ["de", "82,5 kg × 8", "12 Wdh."],
  ] as const) {
    it(`in ${language}`, async () => {
      const store = new MemoryStore();
      await store.open("workout");
      const host = createHost();
      // Its translations are its catalogs, beside it (docs/30), as the shell hands them over.
      const loaded = await host.load({ kind: "module", app: workout as never, catalogs: WORKOUT_CATALOGS });
      const runtime = createRuntime({ app: loaded, host, store, caps: new FakeCapabilities(), ui, nav, languages: [language] });
      const format = computedInfo(runtime.definition.entities.exercise as unknown as EntityDef, "lastBest")?.format;
      expect(format).toBeDefined();
      expect(runtime.ctx.t(format!, { kg: 82.5, reps: 8 })).toBe(heavy);
      expect(runtime.ctx.t(format!, { kg: 0, reps: 12 })).toBe(bodyweight);
    });
  }
});
