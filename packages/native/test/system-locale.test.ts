import { afterEach, describe, expect, it, vi } from "vitest";

// The phone's language, boxed (#298). The plugin is a Proxy that answers ANY method — `then`
// included — so the fixture's `then` never settles: if the plugin object ever leaks out of
// `systemLanguages()` into an await, this test hangs instead of passing (see deep-links.ts).
function pluginProxy(answers: Record<string, unknown>): unknown {
  return new Proxy(
    {},
    {
      get: (_t, prop) => (prop === "then" ? () => new Promise(() => {}) : (answers as Record<string | symbol, unknown>)[prop]),
    },
  );
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@capacitor/core");
  vi.doUnmock("@capacitor/device");
});

describe("systemLanguages", () => {
  it("is null on the web", async () => {
    vi.doMock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
    const { systemLanguages } = await import("../src/system-locale.js");
    expect(await systemLanguages()).toBeNull();
  });

  it("returns the system language tag on a device, as plain strings", async () => {
    vi.doMock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
    vi.doMock("@capacitor/device", () => ({ Device: pluginProxy({ getLanguageTag: async () => ({ value: "pl-PL" }) }) }));
    const { systemLanguages } = await import("../src/system-locale.js");
    expect(await systemLanguages()).toEqual(["pl-PL"]);
  });

  it("is null when the shell has no Device plugin", async () => {
    vi.doMock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
    vi.doMock("@capacitor/device", () => {
      throw new Error("not installed");
    });
    const { systemLanguages } = await import("../src/system-locale.js");
    expect(await systemLanguages()).toBeNull();
  });
});
