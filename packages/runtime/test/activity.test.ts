// Turning the CRDT log into "Bruno added Milk to Weekly" (KA-36).
//
// Driven through a fake `Store` rather than a real cojson node: what is under test here is the
// COMPOSITION — folding writes into events, what counts as visible, labels, names, ordering,
// windowing — and `edit-history.test.ts` already proves the log itself is read correctly and
// attributed across peers. Keeping the two separate means a failure here points at the sentence,
// not at the engine.

import { describe, expect, it } from "vitest";
import type { AppDefinition } from "potyro";
import type { FieldEdit, Removal, Store } from "@potyro/store";
import { FOLD_WINDOW_MS, activitySince, activitySupported, foldEdits } from "../src/activity.js";

const ANA = { id: "co_zAna", name: "Ana" };
const BRUNO = { id: "co_zBruno", name: "Bruno" };

const definition = {
  id: "shopping",
  name: "Shopping",
  version: "1.0.0",
  schemaVersion: 1,
  entities: {
    list: { label: "List", displayField: "title", fields: { title: { type: "text" } } },
    item: {
      label: "Item",
      displayField: "name",
      fields: {
        name: { type: "text" },
        qty: { type: "number", label: "Quantity" },
        bought: { type: "boolean", label: "Bought" },
        boughtBy: { type: "member" },
        list: { type: "relation", to: "list", required: true },
        note: { type: "text", hidden: true },
      },
    },
    // The app's own bookkeeping: who is which colour. Not something anyone is told about.
    writer: { label: "Writer", hidden: true, displayField: "person", fields: { person: { type: "member" }, color: { type: "number" } } },
  },
  pages: [],
} as unknown as AppDefinition;

const t = (iso: string) => new Date(iso);
const plus = (iso: string, ms: number) => new Date(t(iso).getTime() + ms);

/** A store that answers `all`, `get`, `editHistory` and `removals`, and nothing else. */
function fakeStore(
  rows: Record<string, Record<string, unknown>[]>,
  history: Record<string, FieldEdit[]>,
  extra?: { removals?: Record<string, Removal[]>; recordMembers?: Array<{ id: string; name?: string }> },
): Store {
  return {
    all: async (entity: string) => (rows[entity] ?? []) as never,
    get: async (entity: string, id: string) => ((rows[entity] ?? []).find((r) => r.id === id) ?? null) as never,
    editHistory: async (_e: string, id: string, opts?: { since?: Date }) => {
      const all = history[id] ?? [];
      return opts?.since ? all.filter((h) => h.at > opts.since!) : all;
    },
    ...(extra?.removals ? { removals: async (entity: string) => extra.removals![entity] ?? [] } : {}),
    ...(extra?.recordMembers ? { recordMembers: async () => extra.recordMembers! } : {}),
  } as unknown as Store;
}

const lists = [{ id: "l1", title: "Weekly", updatedAt: "2026-08-01T00:00:00Z" }];
const milk = { id: "r1", name: "Milk", list: "l1", updatedAt: "2026-08-09T12:00:00Z" };
/** Milk as Ana created it at 10:00, every field in one go. */
const created = (by = ANA.id, at = "2026-08-09T10:00:00Z"): FieldEdit[] => [
  { field: "name", value: "Milk", by, at: t(at) },
  { field: "qty", value: 2, by, at: t(at) },
  { field: "list", value: "l1", by, at: t(at) },
  { field: "bought", value: false, by, at: t(at) },
];
const deps = (store: Store) => ({ store, definition, me: ANA, members: [ANA, BRUNO] });

describe("activitySupported", () => {
  it("is false for a store that keeps no history", () => {
    expect(activitySupported({} as Store)).toBe(false);
  });
  it("is true when the store can answer", () => {
    expect(activitySupported({ editHistory: async () => [] } as unknown as Store)).toBe(true);
  });
});

describe("the unit is a record, not a field", () => {
  it("folds a creation's many field writes into one 'added', naming the record and what it belongs to", async () => {
    const store = fakeStore({ list: lists, item: [milk] }, { r1: created() });
    const events = await activitySince(deps(store));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "added", entity: "item", recordId: "r1", label: "Milk", parent: "Weekly", byName: "You" });
    expect(events[0]!.text).toBe("You added Milk to Weekly");
  });

  it("folds a form save — several fields, one person, one moment — into one 'changed'", async () => {
    const store = fakeStore(
      { list: lists, item: [milk] },
      {
        r1: [
          ...created(),
          { field: "name", value: "Whole milk", by: BRUNO.id, at: t("2026-08-09T11:00:00Z") },
          { field: "qty", value: 3, by: BRUNO.id, at: plus("2026-08-09T11:00:00Z", 5) },
        ],
      },
    );
    const events = await activitySince(deps(store));
    expect(events.map((e) => e.text)).toEqual(["Bruno changed Milk in Weekly", "You added Milk to Weekly"]);
  });

  it("reads a lone box as ticked or unticked, by the box's label", async () => {
    const store = fakeStore(
      { list: lists, item: [milk] },
      {
        r1: [
          ...created(),
          { field: "bought", value: true, by: BRUNO.id, at: t("2026-08-09T11:00:00Z") },
          { field: "bought", value: false, by: BRUNO.id, at: t("2026-08-09T11:30:00Z") },
        ],
      },
    );
    const events = await activitySince(deps(store));
    expect(events.map((e) => e.text)).toEqual(["Bruno unticked Bought on Milk in Weekly", "Bruno ticked Bought on Milk in Weekly", "You added Milk to Weekly"]);
    expect(events[1]).toMatchObject({ kind: "ticked", field: "Bought" });
  });

  it("starts a new event after a pause, and another for a different person", async () => {
    const store = fakeStore(
      { list: lists, item: [milk] },
      {
        r1: [
          ...created(),
          { field: "qty", value: 3, by: ANA.id, at: plus("2026-08-09T10:00:00Z", FOLD_WINDOW_MS + 1) },
          { field: "qty", value: 4, by: BRUNO.id, at: plus("2026-08-09T10:00:00Z", FOLD_WINDOW_MS + 2) },
        ],
      },
    );
    const events = await activitySince(deps(store));
    expect(events.map((e) => [e.kind, e.byName])).toEqual([
      ["changed", "Bruno"],
      ["changed", "You"],
      ["added", "You"],
    ]);
  });

  it("reports a removal, naming the record as it was", async () => {
    const store = fakeStore(
      { list: lists, item: [] },
      {},
      { removals: { item: [{ id: "r1", record: { ...milk, createdAt: "", updatedBy: BRUNO.id } as never, by: BRUNO.id, at: t("2026-08-09T13:00:00Z") }] } },
    );
    const events = await activitySince(deps(store));
    expect(events.map((e) => e.text)).toEqual(["Bruno removed Milk from Weekly"]);
    expect(events[0]!.kind).toBe("removed");
  });
});

describe("only what a person can see counts", () => {
  it("says nothing about a hidden entity, however often it is written", async () => {
    const swatches: FieldEdit[] = Array.from({ length: 8 }, (_, i) => ({ field: "color", value: i, by: BRUNO.id, at: plus("2026-08-09T11:00:00Z", i * 1000) }));
    const store = fakeStore({ writer: [{ id: "w1", person: BRUNO.id, color: 7, updatedAt: "2026-08-09T11:00:08Z" }] }, { w1: swatches });
    expect(await activitySince(deps(store))).toEqual([]);
  });

  it("ignores a hidden field, and an event with nothing visible in it", async () => {
    const store = fakeStore(
      { list: lists, item: [milk] },
      { r1: [...created(), { field: "note", value: "o:co_x_session_y:21:6", by: BRUNO.id, at: t("2026-08-09T11:00:00Z") }] },
    );
    const events = await activitySince(deps(store));
    expect(events.map((e) => e.text)).toEqual(["You added Milk to Weekly"]);
  });

  it("ignores a field rewritten to the value it already had (a form save touches every field)", async () => {
    const store = fakeStore(
      { list: lists, item: [milk] },
      { r1: [...created(), { field: "name", value: "Milk", by: BRUNO.id, at: t("2026-08-09T11:00:00Z") }] },
    );
    const events = await activitySince(deps(store));
    expect(events.map((e) => e.kind)).toEqual(["added"]);
  });

  it("does not announce a value that never took (KA-21)", async () => {
    const store = fakeStore(
      { list: lists, item: [milk] },
      { r1: [...created(), { field: "qty", value: "lots", by: BRUNO.id, at: t("2026-08-09T11:00:00Z") }] },
    );
    const events = await activitySince(deps(store));
    expect(events.map((e) => e.kind)).toEqual(["added"]);
  });
});

describe("names, not ids", () => {
  it("names a member display field by the person, and a relation by its record", async () => {
    const def = {
      ...definition,
      entities: { ...definition.entities, item: { ...definition.entities.item, displayField: "boughtBy" } },
    } as AppDefinition;
    const store = fakeStore({ list: lists, item: [{ ...milk, boughtBy: BRUNO.id }] }, { r1: created(BRUNO.id) });
    const [event] = await activitySince({ ...deps(store), definition: def });
    expect(event!.text).toBe("Bruno added Bruno to Weekly");
  });

  it("asks the record's own group for someone the space does not know — a document-link participant", async () => {
    const GUEST = { id: "co_zLinkGuest", name: "Carla" };
    const store = fakeStore({ list: lists, item: [milk] }, { r1: created(GUEST.id) }, { recordMembers: [ANA, GUEST] });
    const [event] = await activitySince(deps(store));
    expect(event!.byName).toBe("Carla");
  });

  it("still renders someone who has left: a short id, never a blank", async () => {
    const store = fakeStore({ list: lists, item: [milk] }, { r1: created("co_zGoneForever") });
    const [event] = await activitySince(deps(store));
    expect(event!.byName).toMatch(/^co_zGone/);
    expect(event!.text).toMatch(/^co_zGone.* added Milk to Weekly$/);
  });

  it("falls back to the entity's name for a record with nothing to call it", async () => {
    const store = fakeStore({ list: lists, item: [{ ...milk, name: "" }] }, { r1: created().filter((e) => e.field !== "name") });
    const [event] = await activitySince(deps(store));
    expect(event!.text).toBe("You added Item to Weekly");
  });
});

describe("since, order, limit", () => {
  it("is newest first", async () => {
    const store = fakeStore(
      { list: lists, item: [milk, { ...milk, id: "r2", name: "Eggs", updatedAt: "2026-08-09T12:00:00Z" }] },
      { r1: created(ANA.id, "2026-08-09T09:00:00Z"), r2: created(BRUNO.id, "2026-08-09T11:00:00Z") },
    );
    const events = await activitySince(deps(store));
    expect(events.map((e) => e.label)).toEqual(["Eggs", "Milk"]);
  });

  it("reports only what happened after the watermark, but still knows a later write is a change, not a creation", async () => {
    const store = fakeStore(
      { list: lists, item: [milk] },
      { r1: [...created(ANA.id, "2026-08-01T10:00:00Z"), { field: "qty", value: 3, by: BRUNO.id, at: t("2026-08-09T11:00:00Z") }] },
    );
    const events = await activitySince(deps(store), t("2026-08-09T00:00:00Z"));
    expect(events.map((e) => e.text)).toEqual(["Bruno changed Milk in Weekly"]);
  });

  it("skips records whose updatedAt predates the watermark without reading their history", async () => {
    let opened = 0;
    const store = fakeStore({ list: lists, item: [{ ...milk, updatedAt: "2026-08-01T00:00:00Z" }] }, {});
    const spy = { ...store, editHistory: async () => (opened++, []) } as unknown as Store;
    expect(await activitySince(deps(spy), t("2026-08-09T00:00:00Z"))).toEqual([]);
    expect(opened).toBe(0);
  });

  it("returns nothing when the store keeps no history", async () => {
    expect(await activitySince({ store: { all: async () => [] } as unknown as Store, definition })).toEqual([]);
  });

  it("honours a limit", async () => {
    const store = fakeStore(
      { list: lists, item: [milk, { ...milk, id: "r2", name: "Eggs" }] },
      { r1: created(), r2: created(BRUNO.id, "2026-08-09T11:00:00Z") },
    );
    expect(await activitySince(deps(store), undefined, { limit: 1 })).toHaveLength(1);
  });
});

describe("foldEdits", () => {
  it("keeps the first 'before' and the last 'after' of a field written twice in one fold", () => {
    const [fold] = foldEdits([
      { field: "qty", before: 1, after: 2, by: ANA.id, at: t("2026-08-09T10:00:00Z") },
      { field: "qty", before: 2, after: 3, by: ANA.id, at: t("2026-08-09T10:00:01Z") },
    ]);
    expect(fold!.fields.get("qty")).toEqual({ before: 1, after: 3 });
  });
});
