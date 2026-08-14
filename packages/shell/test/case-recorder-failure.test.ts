// This test lives in its own file because it needs a module-level `vi.mock` of `@karta/runtime`
// that only breaks `addStep` — every other `case-recorder.test.ts` test needs the REAL `addStep`
// to record steps correctly, and `vi.mock` factories apply for the whole file they're declared in.
// Splitting this one assertion out lets it mock just what it needs (via `importActual` for
// `newCase`) without poisoning the rest of the suite.
//
// This exists to catch a specific regression: `wrapNav`'s load-bearing guarantee is that a
// recording failure must never block navigation (see the try/catch in case-recorder.ts). A test
// that never makes recording throw can't tell a version WITH that try/catch from a version
// WITHOUT it — both pass. This test forces `addStep` to throw mid-recording and asserts `nav`
// still ran.

import { describe, expect, it, vi } from "vitest";

vi.mock("@karta/runtime", async (importActual) => {
  const actual = await importActual<typeof import("@karta/runtime")>();
  return {
    ...actual,
    addStep: () => {
      throw new Error("recorder blew up");
    },
  };
});

const { CaseRecorder } = await import("../src/case-recorder.js");

describe("CaseRecorder when recording itself fails", () => {
  it("still navigates", () => {
    const nav = vi.fn();
    const r = new CaseRecorder();
    const wrapped = r.wrapNav(nav);
    r.start("city-maps", "clicking a city");

    expect(() => wrapped("city-detail", { cityId: "c1" })).not.toThrow();
    expect(nav).toHaveBeenCalledWith("city-detail", { cityId: "c1" });
  });
});
