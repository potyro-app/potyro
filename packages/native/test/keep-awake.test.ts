import { describe, expect, it } from "vitest";
import { keepScreenOn, keepScreenOnOver, type KeepAwakePlugin } from "../src/keep-awake.js";

// The screen kept on in the Android app (`ctx.ui.keepAwake`, docs/04): the window flag through
// `PotyroKeepAwake`, and — anywhere without it — `false`, so the shell uses the web's wake lock.

describe("keep-awake", () => {
  it("keeps and allows through the plugin", async () => {
    const calls: string[] = [];
    const plugin: KeepAwakePlugin = { keep: async () => void calls.push("keep"), allow: async () => void calls.push("allow") };
    expect(await keepScreenOnOver(plugin, true)).toBe(true);
    expect(await keepScreenOnOver(plugin, false)).toBe(true);
    expect(calls).toEqual(["keep", "allow"]);
  });

  it("an app without the plugin answers false rather than throwing", async () => {
    const plugin: KeepAwakePlugin = { keep: async () => Promise.reject(new Error("not implemented")), allow: async () => {} };
    expect(await keepScreenOnOver(plugin, true)).toBe(false);
  });

  it("off a device there is no native way", async () => {
    expect(await keepScreenOn(true)).toBe(false);
  });
});
