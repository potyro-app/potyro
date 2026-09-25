// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { AppDefinition, KartaRecord } from "karta";
import { applyProposal, findByName, prepareReview, runActions, ApplyError } from "../src/ask-apply.js";

// Ask's actions and name matches (#213), the shell's half. The model named records the way the
// person did ("the fern", "Kitchen"); which records those are is decided HERE, on the device, since
// the model never saw them. One exact match is ticked; a partial one is offered, unticked; none is
// said plainly. Nothing runs until the person accepts.

const DEF = {
  id: "plants",
  name: "Plants",
  entities: {
    room: { displayField: "name", fields: { name: { type: "text" } } },
    plant: {
      displayField: "name",
      fields: { name: { type: "text" }, room: { type: "relation", to: "room" } },
      actions: {
        water: () => undefined,
        feed: { run: () => undefined, label: "Feed", input: { grams: { type: "number" } } },
        move: { run: () => undefined, label: "Move", input: { to: { type: "relation", to: "room" } } },
      },
    },
  },
  pages: [],
} as unknown as AppDefinition;

const EXISTING = {
  room: [{ id: "r1", name: "Kitchen" }, { id: "r2", name: "Bedroom" }],
  plant: [
    { id: "p1", name: "Monstera" },
    { id: "p2", name: "Boston fern" },
    { id: "p3", name: "Bird's nest fern" },
  ],
};

describe("findByName", () => {
  it("an exact name wins; otherwise names that contain it; plurals too", () => {
    expect(findByName(DEF, "plant", EXISTING.plant, "monstera")).toEqual({ exact: ["p1"], partial: [] });
    expect(findByName(DEF, "plant", EXISTING.plant, "fern")).toEqual({ exact: [], partial: ["p2", "p3"] });
    expect(findByName(DEF, "plant", EXISTING.plant, "ferns")).toEqual({ exact: [], partial: ["p2", "p3"] });
    expect(findByName(DEF, "plant", EXISTING.plant, "cactus")).toEqual({ exact: [], partial: [] });
  });
});

describe("prepareReview", () => {
  it("resolves a row's link by name, and says when it cannot", () => {
    const review = prepareReview(
      DEF,
      {
        summary: "",
        rows: [
          { entity: "plant", ref: "b", values: { name: "Basil", room: { match: "kitchen" } } },
          { entity: "plant", ref: "c", values: { name: "Chili", room: { match: "Garage" } } },
        ],
        actions: [],
      },
      EXISTING,
    );
    expect(review.rows[0]!.values.room).toBe("r1");
    expect(review.rows[1]!.values.room).toBeUndefined();
    expect(review.rows[1]!.notes.join()).toMatch(/Garage/);
  });

  it("offers action targets: new rows and exact matches ticked, partial ones not, none said", () => {
    const review = prepareReview(
      DEF,
      {
        summary: "",
        rows: [{ entity: "plant", ref: "b", values: { name: "Basil" } }],
        actions: [
          { entity: "plant", action: "water", on: "@b" },
          { entity: "plant", action: "water", match: "monstera" },
          { entity: "plant", action: "water", match: "fern" },
          { entity: "plant", action: "feed", match: "cactus", input: { grams: 5 } },
        ],
      },
      EXISTING,
    );
    const [onNew, exact, partial, none] = review.actions;
    expect(onNew!.targets).toEqual([{ kind: "new", ref: "b", name: "Basil", ticked: true }]);
    expect(exact!.targets).toEqual([{ kind: "existing", id: "p1", name: "Monstera", ticked: true }]);
    expect(partial!.targets.map((t) => [t.name, t.ticked])).toEqual([["Boston fern", false], ["Bird's nest fern", false]]);
    expect(none!.targets).toEqual([]);
    expect(none!.notes.join()).toMatch(/cactus/);
    expect(none!.label).toBe("Feed");
  });

  it("resolves a link inside an action's input by name", () => {
    const review = prepareReview(DEF, { summary: "", rows: [], actions: [{ entity: "plant", action: "move", match: "monstera", input: { to: { match: "Bedroom" } } }] }, EXISTING);
    expect(review.actions[0]!.input).toEqual({ to: "r2" });
  });
});

describe("applying rows and actions", () => {
  function fakeRuntime(failOn?: string) {
    const created: Array<{ entity: string; data: Record<string, unknown>; id: string }> = [];
    const ran: string[] = [];
    let n = 0;
    return {
      created,
      ran,
      create: async (entity: string, data: Partial<KartaRecord>) => {
        const id = `new${++n}`;
        created.push({ entity, data: data as Record<string, unknown>, id });
        return { ...data, id } as KartaRecord;
      },
      patch: async () => undefined,
      runAction: async (entity: string, action: string, id: string, input?: unknown) => {
        if (id === failOn) throw new Error("the pot is full");
        ran.push(`${entity}.${action}(${id})${input ? JSON.stringify(input) : ""}`);
      },
    };
  }

  it("keeps a link resolved to an existing record, and gives back the new ids", async () => {
    const rt = fakeRuntime();
    const out = await applyProposal(rt, DEF, [{ entity: "plant", ref: "b", values: { name: "Basil", room: "r1" } }]);
    expect(rt.created[0]!.data).toEqual({ name: "Basil", room: "r1" });
    expect(out.ids.get("b")).toBe("new1");
    expect(out.created).toBe(1);
  });

  it("runs the ticked actions in order, on new and existing records", async () => {
    const rt = fakeRuntime();
    const n = await runActions(rt, [
      { entity: "plant", action: "water", id: "new1" },
      { entity: "plant", action: "feed", id: "p1", input: { grams: 5 } },
    ]);
    expect(n).toBe(2);
    expect(rt.ran).toEqual(["plant.water(new1)", 'plant.feed(p1){"grams":5}']);
  });

  it("stops at an action that fails and says how many ran", async () => {
    const rt = fakeRuntime("p2");
    const err = await runActions(rt, [
      { entity: "plant", action: "water", id: "p1" },
      { entity: "plant", action: "water", id: "p2" },
      { entity: "plant", action: "water", id: "p3" },
    ]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplyError);
    expect((err as ApplyError).created).toBe(1);
    expect((err as ApplyError).message).toMatch(/pot is full/);
  });
});
