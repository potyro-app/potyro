// Turning the CRDT log into "Ana changed Quantity from 2 to 3 on Milk" (KA-36).
//
// Driven through a fake `Store` rather than a real cojson node: what is under test here is the
// COMPOSITION — labels, names, from/to pairing, ordering, windowing — and `jazz-store.test.ts`
// already proves the log itself is read correctly and attributed across peers. Keeping the two
// separate means a failure here points at the sentence, not at the engine.

import { describe, expect, it } from "vitest";
import type { AppDefinition } from "potyro";
import type { FieldEdit, Store } from "@potyro/store";
import { activitySince, activitySupported } from "../src/activity.js";

const ANA = { id: "co_zAna", name: "Ana" };
const BRUNO = { id: "co_zBruno", name: "Bruno" };

const definition = {
  id: "shopping",
  name: "Shopping",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    item: {
      displayField: "name",
      fields: {
        name: { type: "text" },
        qty: { type: "number", label: "Quantity" },
        boughtBy: { type: "member" },
        needsChilling: { type: "boolean" },
      },
    },
  },
  pages: [],
} as unknown as AppDefinition;

const t = (iso: string) => new Date(iso);

/** A store that answers `all` and `editHistory` and nothing else. */
function fakeStore(rows: Record<string, unknown>[], history: Record<string, FieldEdit[]>): Store {
  return {
    all: async () => rows as never,
    editHistory: async (_e: string, id: string, opts?: { since?: Date }) => {
      const all = history[id] ?? [];
      return opts?.since ? all.filter((h) => h.at > opts.since!) : all;
    },
  } as unknown as Store;
}

describe("activitySupported", () => {
  it("is false for a store that keeps no history", () => {
    expect(activitySupported({} as Store)).toBe(false);
  });
  it("is true when the store can answer", () => {
    expect(activitySupported(fakeStore([], {}))).toBe(true);
  });
});

describe("activitySince", () => {
  const rows = [{ id: "r1", name: "Milk", updatedAt: "2026-08-09T12:00:00Z" }];

  it("names the field by its declared label, and the record by its display field", async () => {
    const store = fakeStore(rows, {
      r1: [{ field: "qty", value: 2, by: BRUNO.id, at: t("2026-08-09T11:00:00Z") }],
    });
    const [item] = await activitySince({ store, definition, me: ANA, members: [ANA, BRUNO] });

    expect(item!.fieldLabel).toBe("Quantity"); // declared label, not the key
    expect(item!.recordLabel).toBe("Milk");
    expect(item!.text).toBe("Bruno set Quantity to 2 on Milk");
  });

  it("pairs consecutive edits into from → to", async () => {
    const store = fakeStore(rows, {
      r1: [
        { field: "qty", value: 2, by: ANA.id, at: t("2026-08-09T10:00:00Z") },
        { field: "qty", value: 3, by: BRUNO.id, at: t("2026-08-09T11:00:00Z") },
      ],
    });
    const items = await activitySince({ store, definition, me: ANA, members: [ANA, BRUNO] });
    const change = items.find((i) => i.from !== undefined)!;

    expect(change.from).toBe(2);
    expect(change.to).toBe(3);
    expect(change.text).toBe("Bruno changed Quantity from 2 to 3 on Milk");
  });

  it("keeps the previous value even when it predates the watermark", async () => {
    // The point of the two-stage read: windowing the history would discard exactly the edit that
    // supplies "from", and the feed would say "set to 3" for what was really a change from 2.
    const store = fakeStore(rows, {
      r1: [
        { field: "qty", value: 2, by: ANA.id, at: t("2026-08-01T10:00:00Z") }, // long before
        { field: "qty", value: 3, by: BRUNO.id, at: t("2026-08-09T11:00:00Z") },
      ],
    });
    const items = await activitySince(
      { store, definition, me: ANA, members: [ANA, BRUNO] },
      t("2026-08-09T00:00:00Z"),
    );

    expect(items).toHaveLength(1); // only the new one is reported…
    expect(items[0]!.from).toBe(2); // …but it knows what it changed from
    expect(items[0]!.text).toBe("Bruno changed Quantity from 2 to 3 on Milk");
  });

  it("says 'You' for your own edits", async () => {
    const store = fakeStore(rows, {
      r1: [{ field: "qty", value: 7, by: ANA.id, at: t("2026-08-09T11:00:00Z") }],
    });
    const [item] = await activitySince({ store, definition, me: ANA, members: [ANA, BRUNO] });
    expect(item!.text).toBe("You set Quantity to 7 on Milk");
  });

  it("still renders someone who has left the space", async () => {
    // A departed member must not blank the line; the edit happened and is part of the record's story.
    const store = fakeStore(rows, {
      r1: [{ field: "qty", value: 1, by: "co_zGoneForever", at: t("2026-08-09T11:00:00Z") }],
    });
    const [item] = await activitySince({ store, definition, me: ANA, members: [ANA] });
    expect(item!.byName).toMatch(/^co_zGone/);
    expect(item!.text).toContain("Quantity");
  });

  it("falls back to a humanised key when the app declared no label", async () => {
    const store = fakeStore(rows, {
      r1: [{ field: "needsChilling", value: true, by: ANA.id, at: t("2026-08-09T11:00:00Z") }],
    });
    const [item] = await activitySince({ store, definition, me: ANA, members: [ANA] });
    expect(item!.fieldLabel).toBe("Needs Chilling"); // the codebase's existing convention
    expect(item!.text).toBe("You set Needs Chilling to yes on Milk");
  });

  it("renders a resolved person or relation by name, never [object Object]", async () => {
    const store = fakeStore(rows, {
      r1: [{ field: "boughtBy", value: { id: BRUNO.id, name: "Bruno" }, by: ANA.id, at: t("2026-08-09T11:00:00Z") }],
    });
    const [item] = await activitySince({ store, definition, me: ANA, members: [ANA, BRUNO] });
    expect(item!.text).toBe("You set Bought By to Bruno on Milk");
  });

  it("is newest first", async () => {
    const store = fakeStore(rows, {
      r1: [
        { field: "name", value: "Milk", by: ANA.id, at: t("2026-08-09T10:00:00Z") },
        { field: "qty", value: 3, by: BRUNO.id, at: t("2026-08-09T11:00:00Z") },
      ],
    });
    const items = await activitySince({ store, definition, me: ANA, members: [ANA, BRUNO] });
    expect(items.map((i) => i.field)).toEqual(["qty", "name"]);
  });

  it("skips records whose updatedAt predates the watermark without reading their history", async () => {
    // The prefilter is what makes this affordable against a log that never shrinks (KA-30).
    let opened = 0;
    const store = {
      all: async () => [{ id: "r1", name: "Milk", updatedAt: "2026-08-01T00:00:00Z" }] as never,
      editHistory: async () => {
        opened++;
        return [];
      },
    } as unknown as Store;

    const items = await activitySince({ store, definition, me: ANA }, t("2026-08-09T00:00:00Z"));
    expect(items).toEqual([]);
    expect(opened).toBe(0);
  });

  it("returns nothing when the store keeps no history", async () => {
    const items = await activitySince({ store: { all: async () => [] } as unknown as Store, definition });
    expect(items).toEqual([]);
  });

  it("honours a limit", async () => {
    const store = fakeStore(rows, {
      r1: Array.from({ length: 10 }, (_, i) => ({
        field: "qty",
        value: i,
        by: ANA.id,
        at: t(`2026-08-09T1${i}:00:00Z`),
      })),
    });
    expect(await activitySince({ store, definition, me: ANA }, undefined, { limit: 3 })).toHaveLength(3);
  });
});

describe("no-op writes", () => {
  const rows = [{ id: "r1", name: "Milk", updatedAt: "2026-08-09T12:00:00Z" }];

  it("ignores a field rewritten to the value it already had", async () => {
    // Saving a form rewrites every field, so untouched ones arrive as edits. "Ana changed Name from
    // Milk to Milk" is noise, and it sits directly next to the change the reader actually wants.
    const store = fakeStore(rows, {
      r1: [
        { field: "name", value: "Milk", by: ANA.id, at: t("2026-08-09T10:00:00Z") },
        { field: "qty", value: 2, by: ANA.id, at: t("2026-08-09T10:00:00Z") },
        { field: "name", value: "Milk", by: BRUNO.id, at: t("2026-08-09T11:00:00Z") }, // rewritten, unchanged
        { field: "qty", value: 5, by: BRUNO.id, at: t("2026-08-09T11:00:00Z") },
      ],
    });

    const items = await activitySince({ store, definition, me: ANA, members: [ANA, BRUNO] });
    // Newest first; ties keep the log's own order, since `Array.sort` is stable and two edits saved
    // in one form submit share a timestamp.
    expect(items.map((i) => i.text)).toEqual([
      "Bruno changed Quantity from 2 to 5 on Milk",
      "You set Name to Milk on Milk",
      "You set Quantity to 2 on Milk",
    ]);
  });

  it("compares structurally, so a rewritten object is not a change", async () => {
    const store = fakeStore(rows, {
      r1: [
        { field: "boughtBy", value: { id: BRUNO.id, name: "Bruno" }, by: ANA.id, at: t("2026-08-09T10:00:00Z") },
        { field: "boughtBy", value: { id: BRUNO.id, name: "Bruno" }, by: ANA.id, at: t("2026-08-09T11:00:00Z") },
      ],
    });
    expect(await activitySince({ store, definition, me: ANA })).toHaveLength(1);
  });

  it("still reports a real change back to a previous value", async () => {
    // 2 -> 5 -> 2 is three states and two changes; the last one is not a no-op just because the
    // value has been seen before.
    const store = fakeStore(rows, {
      r1: [
        { field: "qty", value: 2, by: ANA.id, at: t("2026-08-09T10:00:00Z") },
        { field: "qty", value: 5, by: BRUNO.id, at: t("2026-08-09T11:00:00Z") },
        { field: "qty", value: 2, by: BRUNO.id, at: t("2026-08-09T12:00:00Z") },
      ],
    });
    const items = await activitySince({ store, definition, me: ANA, members: [ANA, BRUNO] });
    expect(items[0]!.text).toBe("Bruno changed Quantity from 5 to 2 on Milk");
  });
});

describe("activitySince and values that did not fit (KA-21)", () => {
  it("does not announce a value that never took, nor use it as the 'from' of the next change", async () => {
    const rows = [{ id: "r1", name: "Milk", updatedAt: "2026-08-09T12:00:00Z" }];
    const history = {
      r1: [
        { field: "qty", value: 2, by: ANA.id, at: t("2026-08-09T09:00:00Z") },
        { field: "qty", value: "lots", by: BRUNO.id, at: t("2026-08-09T10:00:00Z") },
        { field: "qty", value: 3, by: ANA.id, at: t("2026-08-09T11:00:00Z") },
      ],
    };
    const items = await activitySince({ store: fakeStore(rows, history), definition, me: ANA, members: [ANA, BRUNO] });
    expect(items.map((i) => i.text)).toEqual(["You changed Quantity from 2 to 3 on Milk", "You set Quantity to 2 on Milk"]);
  });
});

