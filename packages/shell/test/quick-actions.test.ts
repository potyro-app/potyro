// An app's quick actions (#484): declared ones are the app's, omitted ones are derived, and a
// declared empty list means none — not "derive the defaults".
import { describe, expect, it } from "vitest";
import { addsByHand, quickActionsOf, type QuickActionDef } from "../src/quick-actions.js";

const add = (e: string) => `Add: ${e}`;

describe("quickActionsOf", () => {
  it("derives an Add per entity when the app declares none", () => {
    expect(quickActionsOf(undefined, ["artwork", "note"], add)).toEqual([
      { id: "new-artwork", label: "Add: artwork", entity: "artwork", mode: "auto", open: true },
      { id: "new-note", label: "Add: note", entity: "note", mode: "auto", open: true },
    ]);
  });

  it("offers nothing when the app declares an empty list", () => {
    expect(quickActionsOf([], ["artwork"], add)).toEqual([]);
  });

  it("offers exactly what the app declares", () => {
    const log: QuickActionDef = { id: "log", label: "Log last night", entity: "checkin", mode: "form" };
    expect(quickActionsOf([log], ["checkin", "tag"], add)).toEqual([log]);
  });
});

describe("addsByHand", () => {
  it("is false only for a declared empty list", () => {
    expect(addsByHand([])).toBe(false);
    expect(addsByHand(undefined)).toBe(true);
    expect(addsByHand([{}])).toBe(true);
  });
});
