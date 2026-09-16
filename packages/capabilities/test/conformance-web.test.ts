// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFORMANCE_CHECKS, createWebCapabilities, type TargetExpectations } from "../src/index.js";

// The shared capability spec (docs/09), run against the WEB target. The same list runs against the
// native target in `packages/native/test/conformance-capacitor.test.ts`: two implementations of one
// interface, written months apart, with nothing until now comparing them.

const inputs: HTMLInputElement[] = [];

beforeEach(() => {
  inputs.length = 0;
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === "input") inputs.push(el as HTMLInputElement);
    return el;
  });
  // happy-dom has no geolocation; the real browser does, and the null branch is covered in web.test.ts.
  // happy-dom has neither of these; a real browser has both, and the null branches are covered in
  // web.test.ts. Stubbed here so the conformance checks exercise the code rather than the absence.
  Object.defineProperty(globalThis.navigator, "vibrate", { configurable: true, value: () => true });
  Object.defineProperty(globalThis.navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 52.52, longitude: 13.405 } }) },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis.navigator, "geolocation");
  Reflect.deleteProperty(globalThis.navigator, "vibrate");
});

const web: TargetExpectations = {
  // A browser cannot promise an exact, app-closed alarm, so it does not claim one: the shell shows
  // an in-app "due" instead. That difference from native is the point of asserting it.
  exactScheduling: false,
  absent: ["notifications"],
  // Stand in for the person choosing a file: the web camera is an <input capture>.
  cue: async () => {
    await Promise.resolve();
    const input = inputs.at(-1);
    if (!input) throw new Error("no file input was opened");
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" })] });
    input.dispatchEvent(new Event("change"));
  },
};

describe("capability conformance — web", () => {
  for (const check of CONFORMANCE_CHECKS) {
    it(check.name, async () => {
      await check.run(createWebCapabilities(), web);
    });
  }
});

describe("what the web target is honest about", () => {
  it("offers no notifications at all rather than pretending to schedule one", () => {
    // The dishonest version of this is a `schedule()` that resolves and never fires.
    expect(createWebCapabilities().notifications).toBeNull();
  });
});

describe("the suite has teeth", () => {
  it("fails a target that claims something it does not do", async () => {
    // A conformance suite nothing can fail is a green light with no lamp in it. This is the exact
    // divergence the suite exists for: a target promising exact scheduling it cannot deliver.
    const check = CONFORMANCE_CHECKS.find((c) => c.name.includes("exact scheduling"))!;
    const liar = {
      ...createWebCapabilities(),
      notifications: { supportsExactScheduling: true, schedule: async () => {}, cancel: async () => {}, list: async () => [] },
    };
    await expect(check.run(liar, { exactScheduling: false })).rejects.toThrow(/exact scheduling/);
  });

  it("fails a target whose reminder does not come back from list()", async () => {
    const check = CONFORMANCE_CHECKS.find((c) => c.name.includes("listed and cancelled"))!;
    const forgetful = {
      ...createWebCapabilities(),
      notifications: { supportsExactScheduling: false, schedule: async () => {}, cancel: async () => {}, list: async () => [] },
    };
    await expect(check.run(forgetful, { exactScheduling: false })).rejects.toThrow(/must appear in list/);
  });
});
