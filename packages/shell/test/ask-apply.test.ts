// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDefinition, KartaRecord } from "karta";
import { ApplyError, applyProposal, markDuplicates } from "../src/ask-apply.js";
import { askEnabled, setAskEnabled } from "../src/ask-setting.js";

// Ask (#213), the shell's half: which proposed rows the person already has (decided HERE, on the
// device, because the model never sees their records), and turning the rows they accepted into
// records, with relations between proposed rows resolved to the ids the store gave them.

const DEF = {
  id: "places",
  name: "Places",
  entities: {
    city: { displayField: "name", fields: { name: { type: "text" } } },
    place: {
      displayField: "name",
      fields: { name: { type: "text" }, city: { type: "relation", to: "city" }, near: { type: "relation", to: "place", many: true } },
    },
    note: { fields: { body: { type: "text" } } },
  },
  pages: [],
} as unknown as AppDefinition;

function fakeRuntime() {
  const created: Array<{ entity: string; data: Record<string, unknown>; id: string }> = [];
  const patched: Array<{ entity: string; id: string; data: Record<string, unknown> }> = [];
  let n = 0;
  return {
    created,
    patched,
    create: async (entity: string, data: Partial<KartaRecord>) => {
      const id = `id${++n}`;
      created.push({ entity, data: data as Record<string, unknown>, id });
      return { ...data, id } as KartaRecord;
    },
    patch: async (entity: string, id: string, data: Partial<KartaRecord>) => void patched.push({ entity, id, data: data as Record<string, unknown> }),
  };
}

describe("markDuplicates", () => {
  it("marks rows whose name the person already has, ignoring case and spacing", () => {
    const rows = [
      { entity: "place", ref: "a", values: { name: "Jardim da Estrela" } },
      { entity: "place", ref: "b", values: { name: "LX Factory" } },
      { entity: "note", ref: "c", values: { body: "hi" } },
    ];
    const existing = { place: [{ id: "x", name: "  jardim da  estrela " }], note: [{ id: "y", body: "hi" }] };
    expect(markDuplicates(DEF, rows, existing).map((r) => r.duplicate)).toEqual([true, false, false]);
  });
});

describe("applyProposal", () => {
  it("creates the accepted rows, linking relations to the new ids", async () => {
    const rt = fakeRuntime();
    const rows = [
      { entity: "place", ref: "p", values: { name: "Park", city: "@lx" } },
      { entity: "city", ref: "lx", values: { name: "Lisbon" } },
    ];
    const count = await applyProposal(rt, DEF, rows);
    expect(count).toBe(2);
    const city = rt.created.find((c) => c.entity === "city")!;
    const place = rt.created.find((c) => c.entity === "place")!;
    expect(place.data.city ?? rt.patched.find((p) => p.id === place.id)?.data.city).toBe(city.id);
  });

  it("links rows that point at each other", async () => {
    const rt = fakeRuntime();
    await applyProposal(rt, DEF, [
      { entity: "place", ref: "a", values: { name: "A", near: ["@b"] } },
      { entity: "place", ref: "b", values: { name: "B", near: ["@a"] } },
    ]);
    const idOf = (name: string) => rt.created.find((c) => c.data.name === name)!.id;
    const nearOf = (name: string) => rt.created.find((c) => c.data.name === name)!.data.near ?? rt.patched.find((p) => p.id === idOf(name))?.data.near;
    expect(nearOf("A")).toEqual([idOf("B")]);
    expect(nearOf("B")).toEqual([idOf("A")]);
  });

  it("drops a link to a row the person left out", async () => {
    const rt = fakeRuntime();
    await applyProposal(rt, DEF, [{ entity: "place", ref: "p", values: { name: "Park", city: "@lx", near: ["@gone"] } }]);
    expect(rt.created[0]!.data).toEqual({ name: "Park" });
    expect(rt.patched).toEqual([]);
  });
});

describe("applyProposal when a write fails", () => {
  it("says how many were saved before it stopped", async () => {
    const rt = fakeRuntime();
    const create = rt.create;
    let n = 0;
    rt.create = async (entity, data) => {
      if (++n === 2) throw new Error("disk full");
      return create(entity, data);
    };
    const rows = [
      { entity: "note", ref: "a", values: { body: "1" } },
      { entity: "note", ref: "b", values: { body: "2" } },
      { entity: "note", ref: "c", values: { body: "3" } },
    ];
    const err = await applyProposal(rt, DEF, rows).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplyError);
    expect((err as ApplyError).created).toBe(1);
    expect((err as ApplyError).message).toMatch(/disk full/);
  });
});

describe("askEnabled", () => {
  beforeEach(() => localStorage.clear());

  it("is on until the person turns it off for that app", () => {
    expect(askEnabled("a")).toBe(true);
    setAskEnabled("a", false);
    expect(askEnabled("a")).toBe(false);
    expect(askEnabled("b")).toBe(true);
    setAskEnabled("a", true);
    expect(askEnabled("a")).toBe(true);
  });
});
