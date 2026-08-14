import { describe, expect, it } from "vitest";
import { addStep, annotate, newCase } from "../src/case.js";
import { replayCase, replayPassed, type ReplayTarget } from "../src/replay.js";

// The exact app shape that fails today: a list whose onOpen points at a page that does not exist.
// It compiles, validates and renders — every gate we have says it is fine.
const target = (pageIds: string[]): ReplayTarget => ({
  definition: {
    pages: pageIds.map((id) => ({ id, title: id, view: { type: "list", entity: "city" } })),
  },
  query: async () => [{ id: "c1", name: "Lisbon" }],
});

describe("replayCase", () => {
  it("fails the step that opens a page the app does not have", async () => {
    let c = newCase("city-maps", "clicking a city");
    c = addStep(c, { kind: "open", page: "all" });
    c = annotate(c, "here I expected the map to open");
    c = addStep(c, { kind: "open", page: "city-detail", params: { cityId: "c1" } });

    const r = await replayCase(target(["all", "detail"]), c);

    expect(replayPassed(r)).toBe(false);
    expect(r.outcomes[2]!.ok).toBe(false);
    expect(r.outcomes[2]!.detail).toContain("city-detail");
    expect(r.outcomes[2]!.detail).toMatch(/no page/i);
    // The failure is reported against what the user SAID they expected.
    expect(r.expectation).toBe("here I expected the map to open");
  });

  it("passes when every page in the path exists and its query runs", async () => {
    let c = newCase("city-maps", "clicking a city");
    c = addStep(c, { kind: "open", page: "all" });
    c = addStep(c, { kind: "open", page: "detail", params: { cityId: "c1" } });

    const r = await replayCase(target(["all", "detail"]), c);

    expect(replayPassed(r)).toBe(true);
    expect(r.outcomes.every((o) => o.ok)).toBe(true);
  });

  it("reports a page that opened but had nothing to show, without calling it a failure", async () => {
    let c = newCase("city-maps", "the map is empty");
    c = addStep(c, { kind: "open", page: "all" });

    const r = await replayCase({ ...target(["all"]), query: async () => [] }, c);

    expect(replayPassed(r)).toBe(true); // navigation worked
    expect(r.outcomes[0]!.detail).toMatch(/0 records/);
  });

  it("reports the error when the page's own query throws", async () => {
    let c = newCase("city-maps", "boom");
    c = addStep(c, { kind: "open", page: "all" });

    const r = await replayCase(
      { ...target(["all"]), query: async () => { throw new Error("filter: r.list is not a function"); } },
      c,
    );

    expect(replayPassed(r)).toBe(false);
    expect(r.outcomes[0]!.detail).toContain("r.list is not a function");
  });
});
