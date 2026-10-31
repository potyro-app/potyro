// A version the Studio held back carries everything it was going to be saved with (#486): Fix it and
// Keep it anyway pick it up again, and for a new app that includes its sample records — lost on the
// way, the app's demo link opened on an empty copy although its records had been written.
import { describe, expect, it } from "vitest";
import { fixedLanding, keptAnyway, seedToSave, type Held } from "../src/studio-held.js";

const made = { plant: [{ id: "plant-1", name: "Monstera by the window" }, { id: "plant-2", name: "Lemon tree" }] };
const held = (over: Partial<Held> = {}): Held => ({
  source: "APP 1",
  summary: "Made it.",
  note: "the plants I water",
  issues: ["pages[0].view.entity: no such entity"],
  loss: null,
  libraries: null,
  made,
  ...over,
});

describe("a held version, picked up again", () => {
  it("Fix it lands the repair with the held app's sample records", () => {
    const l = fixedLanding(held(), { source: "APP 2", summary: "Fixed the page.", loss: null });
    expect(l).toEqual({ source: "APP 2", summary: "Made it. Fixed the page.", note: "the plants I water", loss: null, made });
  });

  it("Fix it keeps the modules it edited when the repair did not send its own", () => {
    const own = { texts: { "a.ts": "export const a = 1;" }, code: { lock: {}, files: [] } };
    expect(fixedLanding(held({ own }), { source: "APP 2", summary: "", loss: null }).modules).toEqual(own.texts);
    expect(fixedLanding(held({ own }), { source: "APP 2", summary: "", loss: null, modules: { "b.ts": "" } }).modules).toEqual({ "b.ts": "" });
  });

  it("Keep it anyway keeps it with the held app's sample records", () => {
    expect(keptAnyway(held(), "Kept with problems.")).toEqual({ source: "APP 1", summary: "Made it. Kept with problems.", note: "the plants I water", libraries: null, made });
  });

  it("a change to an app that has some carries none: it keeps its own", () => {
    expect(fixedLanding(held({ made: undefined }), { source: "APP 2", summary: "", loss: null })).not.toHaveProperty("made");
    expect(keptAnyway(held({ made: undefined }), "")).not.toHaveProperty("made");
  });
});

describe("the seed a saved version sets", () => {
  it("a new app's is its sample records; a changed app's kept seed is left as it is", () => {
    expect(seedToSave(true, made)).toEqual({ seed: made });
    expect(seedToSave(false, made)).toEqual({});
    expect(seedToSave(true, undefined)).toEqual({});
  });
});
