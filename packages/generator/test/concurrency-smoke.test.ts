// Does the concurrency gate actually catch the two defects that reached a real user?
//
// The app below is a faithful reduction of `shared-todo`: a count you nudge with +1, and a numeric
// `order` you move a row by swapping with its neighbour. Both are the most ordinary things a list
// app does, both passed every existing gate, and both destroyed data in the wild.

import { describe, expect, it } from "vitest";
import { defineApp } from "potyro";
import { concurrencySmoke, concurrencyPassed } from "../src/concurrency-smoke.js";
import { seedRecords } from "../src/smoke.js";

const UNSAFE = defineApp({
  id: "unsafe-list",
  name: "Unsafe List",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      displayField: "title",
      fields: {
        title: { type: "text", required: true },
        bought: { type: "number" },
        order: { type: "number" },
      },
      actions: {
        // Read what is on screen, add one, write it back — the shape of every counter button.
        bump: async (record, ctx) => {
          await ctx.patch("item", record.id as string, { bought: Number(record.bought ?? 0) + 1 });
        },
      },
    },
  },
  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } }],
});

const SAFE = defineApp({
  id: "safe-list",
  name: "Safe List",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      displayField: "title",
      fields: { title: { type: "text", required: true }, done: { type: "boolean" } },
      actions: {
        // Sets an absolute value. Running it twice at once is the same as twice in a row, so there
        // is nothing to lose — this is what must NOT be reported.
        finish: async (record, ctx) => {
          await ctx.patch("item", record.id as string, { done: true });
        },
      },
    },
  },
  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } }],
});

const SWAPPER = defineApp({
  id: "swap-list",
  name: "Swap List",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      displayField: "title",
      fields: { title: { type: "text", required: true }, order: { type: "number" } },
      actions: {
        // Move a row by SWAPPING its sort key with its neighbour: two records, two writes, no
        // atomicity. Exactly what `shared-todo` did, and exactly what fused two rows in the wild.
        moveUp: async (record, ctx) => {
          const rows = (await ctx.query("item")) as unknown as { id: string; order: number }[];
          const sorted = [...rows].sort((a, b) => Number(a.order) - Number(b.order));
          const i = sorted.findIndex((r) => r.id === record.id);
          if (i <= 0) return;
          const me = sorted[i]!;
          const above = sorted[i - 1]!;
          await ctx.patch("item", me.id, { order: Number(above.order) });
          await ctx.patch("item", above.id, { order: Number(me.order) });
        },
      },
    },
  },
  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } }],
});

const seed =
  (app: Parameters<typeof seedRecords>[0]) =>
  async (runtime: unknown): Promise<Record<string, string[]>> =>
    (await seedRecords(app, runtime as never)).created;

const COUNTED = defineApp({
  id: "counted-list",
  name: "Counted List",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      displayField: "title",
      fields: { title: { type: "text", required: true }, bought: { type: "number" } },
      actions: {
        // The same button as UNSAFE, written the safe way: state the CHANGE, not the result.
        bump: async (record, ctx) => {
          await ctx.increment("item", record.id as string, "bought", 1);
        },
      },
    },
  },
  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } }],
});

const BROKEN = defineApp({
  id: "broken-list",
  name: "Broken List",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      displayField: "title",
      fields: { title: { type: "text", required: true }, done: { type: "boolean" } },
      actions: {
        // A method ctx does not have — what a model invents. The button would show a toast.
        finish: async (record, ctx) => {
          await (ctx as unknown as { markDone: (id: string) => Promise<void> }).markDone(record.id as string);
        },
      },
    },
  },
  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } }],
});

const ASKS = defineApp({
  id: "asks-list",
  name: "Asks List",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      label: "Item",
      displayField: "title",
      fields: { title: { type: "text", required: true }, note: { type: "text" } },
      actions: {
        // Declares what it needs; with none given the runtime would open a form nobody answers.
        annotate: {
          label: "Add a note",
          input: { note: { type: "text", required: true } },
          run: async (record, ctx, input) => {
            const note = (input as { note?: string } | undefined)?.note;
            if (!note) throw new Error("annotate ran without its input");
            await ctx.patch("item", record.id as string, { note });
          },
        },
      },
    },
  },
  pages: [{ id: "all", title: "Items", view: { type: "list", entity: "item", display: { primary: "title" } } }],
});

describe("the concurrency gate", () => {
  it("catches a counter that loses one of two simultaneous presses", async () => {
    const r = await concurrencySmoke(UNSAFE as never, seed(UNSAFE as never));
    expect(r.errors, `setup failed: ${r.errors.join("; ")}`).toEqual([]);
    expect(r.ran.actions).toBeGreaterThan(0);

    const lost = r.hazards.filter((h) => h.kind === "lost-update");
    expect(lost.length, JSON.stringify(r.hazards, null, 1)).toBeGreaterThan(0);
    expect(lost[0]!.field).toBe("bought");
    expect(concurrencyPassed(r)).toBe(false);
  }, 60_000);

  it("catches a reorder that fuses two rows onto one sort key", async () => {
    // The defect that reached a real user and could not be undone: once two rows share a sort key,
    // swapping them exchanges equal values, so "move up" does nothing for ever.
    const r = await concurrencySmoke(SWAPPER as never, seed(SWAPPER as never));
    expect(r.ran.actions).toBeGreaterThan(0);
    const fused = r.hazards.filter((h) => h.kind === "fused-key");
    expect(fused.length, JSON.stringify(r.hazards, null, 1)).toBeGreaterThan(0);
    expect(fused[0]!.field).toBe("order");
  }, 60_000);

  it("goes quiet once the same button uses ctx.increment", async () => {
    // The whole thesis of the remap, closed end to end: the app's shape is unchanged, `bought` is
    // still one number, and the gate that condemned the `patch` version has nothing to report.
    const r = await concurrencySmoke(COUNTED as never, seed(COUNTED as never));
    expect(r.errors, `setup failed: ${r.errors.join("; ")}`).toEqual([]);
    expect(r.ran.actions).toBeGreaterThan(0);
    expect(r.hazards, JSON.stringify(r.hazards, null, 1)).toEqual([]);
    expect(concurrencyPassed(r)).toBe(true);
  }, 60_000);

  it("does NOT flag an action that legitimately sets an absolute value", async () => {
    // The check that keeps this useful. A gate that cried wolf on every toggle would be turned off
    // within a week, and then it would be catching nothing at all.
    const r = await concurrencySmoke(SAFE as never, seed(SAFE as never));
    expect(r.errors, `setup failed: ${r.errors.join("; ")}`).toEqual([]);
    expect(r.ran.actions).toBeGreaterThan(0);
    expect(r.hazards, JSON.stringify(r.hazards, null, 1)).toEqual([]);
    expect(concurrencyPassed(r)).toBe(true);
  }, 60_000);

  it("reports an action that throws, instead of treating it as a clean run", async () => {
    const r = await concurrencySmoke(BROKEN as never, seed(BROKEN as never));
    expect(r.errors.join("; ")).toMatch(/item\.finish/);
    expect(concurrencyPassed(r)).toBe(false);
  }, 60_000);

  it("runs an action that declares input, with seeded input", async () => {
    const r = await concurrencySmoke(ASKS as never, seed(ASKS as never));
    expect(r.errors, `setup failed: ${r.errors.join("; ")}`).toEqual([]);
    expect(r.ran.actions).toBeGreaterThan(0);
    expect(concurrencyPassed(r)).toBe(true);
  }, 60_000);
});
