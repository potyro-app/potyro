import { describe, expect, it, vi } from "vitest";
import { CaseRecorder } from "../src/case-recorder.js";

describe("CaseRecorder", () => {
  it("passes navigation through untouched when not recording", () => {
    const nav = vi.fn();
    const r = new CaseRecorder();
    r.wrapNav(nav)("detail", { cityId: "c1" });

    expect(nav).toHaveBeenCalledWith("detail", { cityId: "c1" });
    expect(r.recording).toBe(false);
  });

  it("captures each navigation as a step while recording", () => {
    const nav = vi.fn();
    const r = new CaseRecorder();
    const wrapped = r.wrapNav(nav);

    r.start("city-maps", "clicking a city");
    wrapped("all");
    wrapped("city-detail", { cityId: "c1" });
    const c = r.stop();

    // The app must still navigate — recording observes, it does not intercept.
    expect(nav).toHaveBeenCalledTimes(2);
    expect(c?.steps).toEqual([
      { kind: "open", page: "all" },
      { kind: "open", page: "city-detail", params: { cityId: "c1" } },
    ]);
    // A clean recording lost nothing — see case-recorder-failure.test.ts for the case where it did.
    expect(r.lost).toBe(0);
  });

  it("resets the lost count when a new recording starts", () => {
    const r = new CaseRecorder();
    r.start("city-maps", "a");
    r.start("city-maps", "b"); // starting again abandons the first recording, cleanly
    expect(r.lost).toBe(0);
  });

  it("anchors a note between the steps it was written between", () => {
    const r = new CaseRecorder();
    const wrapped = r.wrapNav(() => {});
    r.start("city-maps", "clicking a city");
    wrapped("all");
    r.note("here I expected the map to open");
    wrapped("nowhere");

    expect(r.stop()?.steps[1]).toEqual({ kind: "expect", note: "here I expected the map to open" });
  });

  it("returns null and still navigates after stop", () => {
    const nav = vi.fn();
    const r = new CaseRecorder();
    const wrapped = r.wrapNav(nav);
    r.start("city-maps", "x");
    r.stop();
    wrapped("all");

    expect(r.stop()).toBeNull();
    expect(nav).toHaveBeenCalledWith("all", undefined);
  });

  it("navigates in all states—not recording, recording, and stopped", () => {
    const nav = vi.fn();
    const r = new CaseRecorder();
    const wrapped = r.wrapNav(nav);

    // Not recording: nav is called.
    wrapped("detail", { cityId: "c1" });
    expect(nav).toHaveBeenNthCalledWith(1, "detail", { cityId: "c1" });

    // Recording: nav is called.
    r.start("city-maps", "test");
    wrapped("all");
    expect(nav).toHaveBeenNthCalledWith(2, "all", undefined);

    // Stopped: nav is still called (try/catch ensures recording failure never blocks navigation).
    r.stop();
    wrapped("back");
    expect(nav).toHaveBeenNthCalledWith(3, "back", undefined);
  });
});
