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
  // THE BUG THAT MADE THIS WHOLE CHECK LOOK USELESS. A page can resolve, its query can return rows,
  // and the screen can still have been stuck on "Loading…" forever — a map that never rendered. With
  // only structure to go on, every line reported ok, the baseline passed, and the loop announced it
  // could not reproduce a problem the person was staring at. What they SAW has to outrank that.
  it("fails a step whose page opened but never finished rendering", async () => {
    let c = newCase("city-maps", "the map never loads");
    c = addStep(c, {
      kind: "open",
      page: "all",
      saw: { loading: true, text: "Loading…" },
    });

    const r = await replayCase(target(["all"]), c);

    expect(replayPassed(r)).toBe(false);
    expect(r.outcomes[0]!.detail).toMatch(/never finished loading/i);
    expect(r.outcomes[0]!.detail).toContain("Loading");
  });

  // The other half: a page that DID settle must not be dragged down by having been observed. A
  // recording that captures a healthy screen still passes, and says what was on it.
  it("passes a step that settled, and reports what was on screen", async () => {
    let c = newCase("city-maps", "looks fine");
    c = addStep(c, { kind: "open", page: "all", saw: { loading: false, text: "Lisbon Porto" } });

    const r = await replayCase(target(["all"]), c);

    expect(replayPassed(r)).toBe(true);
    expect(r.outcomes[0]!.detail).toContain("on screen: Lisbon Porto");
  });


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

  it("reports an action step it has no way to run", async () => {
    let c = newCase("city-maps", "logging a visit");
    c = addStep(c, { kind: "action", entity: "city", action: "visit", recordId: "c1" });

    const r = await replayCase(target(["all"]), c); // no runAction configured

    expect(replayPassed(r)).toBe(false);
    expect(r.outcomes[0]!.detail).toMatch(/visit/);
  });

  it("runs an action step and reports it", async () => {
    const ran: string[] = [];
    let c = newCase("city-maps", "logging a visit");
    c = addStep(c, { kind: "action", entity: "city", action: "visit", recordId: "c1" });

    const r = await replayCase(
      { ...target(["all"]), runAction: async (e, a, id) => { ran.push(`${e}.${a}(${id})`); } },
      c,
    );

    expect(replayPassed(r)).toBe(true);
    expect(ran).toEqual(["city.visit(c1)"]);
  });

  it("reports the real error when an action throws", async () => {
    let c = newCase("city-maps", "logging a visit");
    c = addStep(c, { kind: "action", entity: "city", action: "visit", recordId: "c1" });

    const r = await replayCase(
      { ...target(["all"]), runAction: async () => { throw new Error("ctx.increment is not a function"); } },
      c,
    );

    expect(replayPassed(r)).toBe(false);
    expect(r.outcomes[0]!.detail).toContain("ctx.increment is not a function");
  });

  it("does not pass a case with no outcomes — [].every() is vacuously true, and nothing ran", async () => {
    // A case with only `expect` steps (or none at all) never reaches replayCase in the shell —
    // app-cases.ts's hasRecordedActivity is meant to stop it — but replayPassed must not rely on
    // every caller remembering that; an empty outcomes list is the one input .every() gets wrong.
    const c = newCase("city-maps", "nothing recorded");

    const r = await replayCase(target(["all"]), c);

    expect(r.outcomes).toHaveLength(0);
    expect(replayPassed(r)).toBe(false);
  });
});
