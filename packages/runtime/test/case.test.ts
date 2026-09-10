import { describe, expect, it } from "vitest";
import { addStep, annotate, newCase } from "../src/case.js";

describe("case model", () => {
  it("records steps in the order they happened", () => {
    let c = newCase("city-maps", "clicking a city");
    c = addStep(c, { kind: "open", page: "all" });
    c = addStep(c, { kind: "open", page: "city-detail", params: { cityId: "c1" } });

    expect(c.appId).toBe("city-maps");
    expect(c.steps).toHaveLength(2);
    expect(c.steps[1]).toEqual({ kind: "open", page: "city-detail", params: { cityId: "c1" } });
  });

  it("does not mutate the case it was given", () => {
    const before = newCase("city-maps", "x");
    const after = addStep(before, { kind: "open", page: "all" });

    expect(before.steps).toHaveLength(0);
    expect(after).not.toBe(before);
  });

  it("attaches the expectation to the point it was written, not the end", () => {
    let c = newCase("city-maps", "clicking a city");
    c = addStep(c, { kind: "open", page: "all" });
    c = annotate(c, "here I expected the map to open");
    c = addStep(c, { kind: "open", page: "elsewhere" });

    expect(c.steps[1]).toEqual({ kind: "expect", note: "here I expected the map to open" });
  });

  it("keeps a recorded step even if the caller reuses the object it passed", () => {
    const params = { cityId: "c1" };
    const c = addStep(newCase("city-maps", "x"), { kind: "open", page: "detail", params });

    params.cityId = "MUTATED";

    expect(c.steps[0]).toEqual({ kind: "open", page: "detail", params: { cityId: "c1" } });
  });
});
