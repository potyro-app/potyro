// Capability mediation, focused on the newly-added haptics cap (docs/04 "grow ctx" example):
// trusted apps get it unmediated; untrusted apps get it only if their manifest declares it
// (haptics is non-sensitive → manifest-gated, no consent prompt).

import { describe, expect, it } from "vitest";
import { FakeCapabilities } from "@potyro/capabilities";
import type { UiBridge } from "../src/index.js";
import { mediateCaps } from "../src/index.js";

const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };

describe("mediateCaps — haptics", () => {
  it("trusted apps get haptics unmediated and it reaches the platform", async () => {
    const caps = new FakeCapabilities();
    const ctxCaps = mediateCaps({ caps, provenance: "trusted", permissions: {}, ui, appName: "X" });
    expect(ctxCaps.haptics).toBeDefined();
    await ctxCaps.haptics!.vibrate(40);
    expect(caps.vibrations).toEqual([40]);
  });

  it("untrusted apps get haptics only when the manifest declares it", async () => {
    const caps = new FakeCapabilities();
    const denied = mediateCaps({ caps, provenance: "untrusted", permissions: {}, ui, appName: "X" });
    expect(denied.haptics).toBeUndefined();

    const granted = mediateCaps({ caps, provenance: "untrusted", permissions: { haptics: true }, ui, appName: "X" });
    expect(granted.haptics).toBeDefined();
    await granted.haptics!.vibrate([0, 100]);
    expect(caps.vibrations).toEqual([[0, 100]]);
  });

  it("omits haptics entirely when the platform has none", () => {
    const caps = new FakeCapabilities({ haptics: false });
    const ctxCaps = mediateCaps({ caps, provenance: "trusted", permissions: { haptics: true }, ui, appName: "X" });
    expect(ctxCaps.haptics).toBeUndefined();
  });
});
