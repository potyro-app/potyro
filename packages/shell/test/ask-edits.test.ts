import { describe, expect, it } from "vitest";
import type { AppDefinition, KartaRecord } from "karta";
import type { Proposal } from "@karta/generator/agent";
import { ApplyError, applyEdits, editApproval, entitiesToLoad, prepareReview } from "../src/ask-apply.js";

// Ask (#213) changing records the person already has. The model named them; which records those are
// is decided HERE, against this device's records, as for an action's targets. The review shows what
// each field holds now next to what it would hold, and nothing is written until the person approves.

const DEF = {
  id: "gym",
  name: "Gym",
  entities: {
    muscle: { displayField: "name", fields: { name: { type: "text", required: true } } },
    exercise: {
      displayField: "name",
      fields: {
        name: { type: "text", required: true },
        sets: { type: "number" },
        cue: { type: "text" },
        targets: { type: "relation", to: "muscle" },
      },
    },
  },
  pages: [],
} as unknown as AppDefinition;

const EXISTING = {
  exercise: [
    { id: "e1", name: "Bench Press", sets: 3, cue: "Arch" },
    { id: "e2", name: "Incline Bench Press", sets: 3 },
    { id: "e3", name: "Squat", sets: 5 },
    { id: "e4", name: "Squat", sets: 4 },
  ],
  muscle: [{ id: "m1", name: "Chest" }],
};

const proposal = (edits: Proposal["edits"], rows: Proposal["rows"] = []): Proposal => ({ summary: "", rows, actions: [], edits });

describe("prepareReview with edits", () => {
  it("finds the record by its exact name, ticks it, and shows what it holds now", () => {
    const review = prepareReview(DEF, proposal([{ ref: "edit:1", entity: "exercise", match: "bench press", set: { sets: 4 } }]), EXISTING);
    expect(review.edits).toHaveLength(1);
    const edit = review.edits[0]!;
    expect(edit.targets).toEqual([{ id: "e1", name: "Bench Press", ticked: true, before: { sets: 3 } }]);
    expect(edit.notes).toEqual([]);
  });

  it("offers more than one record by that name unticked, and says so", () => {
    const edit = prepareReview(DEF, proposal([{ ref: "edit:1", entity: "exercise", match: "Squat", set: { sets: 3 } }]), EXISTING).edits[0]!;
    expect(edit.targets.map((t) => [t.id, t.ticked])).toEqual([
      ["e3", false],
      ["e4", false],
    ]);
    expect(edit.notes.join(" ")).toMatch(/more than one/i);
  });

  it("says plainly when nothing has that name", () => {
    const edit = prepareReview(DEF, proposal([{ ref: "edit:1", entity: "exercise", match: "Deadlift", set: { sets: 3 } }]), EXISTING).edits[0]!;
    expect(edit.targets).toEqual([]);
    expect(edit.notes.join(" ")).toMatch(/No .*“Deadlift”/);
  });

  it("resolves links in what it sets: a record by name, or a row of the same proposal", () => {
    const byName = prepareReview(DEF, proposal([{ ref: "edit:1", entity: "exercise", match: "Bench Press", set: { targets: { match: "chest" } } }]), EXISTING).edits[0]!;
    expect(byName.set).toEqual({ targets: "m1" });
    const byRef = prepareReview(
      DEF,
      proposal([{ ref: "edit:1", entity: "exercise", match: "Bench Press", set: { targets: "@t" } }], [{ entity: "muscle", ref: "t", values: { name: "Triceps" } }]),
      EXISTING,
    ).edits[0]!;
    expect(byRef.set).toEqual({ targets: "@t" });
  });

  it("carries the edit's trust", () => {
    const trust = { status: "corroborated" as const, sources: [{ url: "karta:request", host: "", quote: "bench press 4 sets", via: "what you asked" }], issues: [] };
    const review = prepareReview(DEF, { ...proposal([{ ref: "edit:1", entity: "exercise", match: "Bench Press", set: { sets: 4 } }]), trust: { "edit:1": trust } }, EXISTING);
    expect(review.edits[0]!.trust).toEqual(trust);
  });

  it("a proposal from before edits existed has none", () => {
    expect(prepareReview(DEF, { summary: "", rows: [], actions: [] }, EXISTING).edits).toEqual([]);
  });

  it("loads the records an edit names, and those its links point at", () => {
    expect(entitiesToLoad(DEF, proposal([{ ref: "edit:1", entity: "exercise", match: "Bench Press", set: { sets: 4 } }])).sort()).toEqual(["exercise", "muscle"]);
  });
});

describe("editApproval", () => {
  const edit = (over: object = {}) => ({ ...prepareReview(DEF, proposal([{ ref: "edit:1", entity: "exercise", match: "Bench Press", set: { sets: 4 } }]), EXISTING).edits[0]!, ...over });

  it("starts approved when one record was found and nothing disputes it", () => {
    expect(editApproval(edit()).approved).toBe(true);
  });

  it("is held back when no record is ticked, with the note as the reason", () => {
    const e = prepareReview(DEF, proposal([{ ref: "edit:1", entity: "exercise", match: "Deadlift", set: { sets: 3 } }]), EXISTING).edits[0]!;
    expect(editApproval(e)).toMatchObject({ approved: false, reason: expect.stringMatching(/Deadlift/) });
  });

  it("is held back when every value it would set is disputed", () => {
    const e = edit({ trust: { status: "corroborated", sources: [], issues: [], fieldIssues: { sets: { kind: "contradicted", why: "The page says 3." } } } });
    expect(editApproval(e)).toMatchObject({ approved: false, reason: "The page says 3." });
  });

  it("is held back when it would change nothing", () => {
    const e = prepareReview(DEF, proposal([{ ref: "edit:1", entity: "exercise", match: "Bench Press", set: { sets: 3 } }]), EXISTING).edits[0]!;
    expect(editApproval(e)).toMatchObject({ approved: false, reason: expect.stringMatching(/already/i) });
  });
});

function fakeWriter() {
  const patched: Array<{ entity: string; id: string; data: Record<string, unknown> }> = [];
  return {
    patched,
    create: async (_e: string, d: Partial<KartaRecord>) => ({ ...d, id: "x" }) as KartaRecord,
    patch: async (entity: string, id: string, data: Partial<KartaRecord>) => void patched.push({ entity, id, data: data as Record<string, unknown> }),
  };
}

describe("applyEdits", () => {
  it("patches each approved record with only the fields that change", async () => {
    const w = fakeWriter();
    const n = await applyEdits(w, DEF, [{ entity: "exercise", id: "e1", set: { sets: 4 } }], new Map(), new Set());
    expect(n).toBe(1);
    expect(w.patched).toEqual([{ entity: "exercise", id: "e1", data: { sets: 4 } }]);
  });

  it("links to a row created in the same review by its new id, and drops a link to one left out", async () => {
    const w = fakeWriter();
    await applyEdits(
      w,
      DEF,
      [
        { entity: "exercise", id: "e1", set: { targets: "@t" } },
        { entity: "exercise", id: "e3", set: { targets: "@gone", sets: 2 } },
      ],
      new Map([["t", "m9"]]),
      new Set(["t"]),
    );
    expect(w.patched).toEqual([
      { entity: "exercise", id: "e1", data: { targets: "m9" } },
      { entity: "exercise", id: "e3", data: { sets: 2 } },
    ]);
  });

  it("empties a field set to null", async () => {
    const w = fakeWriter();
    await applyEdits(w, DEF, [{ entity: "exercise", id: "e1", set: { cue: null, targets: null } }], new Map(), new Set());
    expect(w.patched[0]!.data).toEqual({ cue: null, targets: null });
  });

  it("says how many were changed before a write failed", async () => {
    let calls = 0;
    const w = {
      create: fakeWriter().create,
      patch: async () => {
        if (calls++) throw new Error("disk full");
      },
    };
    const err = await applyEdits(w as never, DEF, [
      { entity: "exercise", id: "e1", set: { sets: 4 } },
      { entity: "exercise", id: "e3", set: { sets: 4 } },
    ], new Map(), new Set()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplyError);
    expect((err as ApplyError).created).toBe(1);
  });
});
