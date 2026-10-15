// The native app asks for persistent storage (docs/27 §3.1): WebKit evicts a whole origin under
// storage pressure unless it is persistent, and on a phone that origin holds every app and record.
import { afterEach, describe, expect, it, vi } from "vitest";
import { keepStorage, keepStorageOn } from "../src/keep-storage.js";

describe("keeping the storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks when it is not persistent yet, and not again when it is", async () => {
    const persist = vi.fn(async () => true);
    expect(await keepStorageOn({ persisted: async () => false, persist })).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
    const again = vi.fn(async () => true);
    expect(await keepStorageOn({ persisted: async () => true, persist: again })).toBe(true);
    expect(again).not.toHaveBeenCalled();
  });

  it("reports a refusal or a missing API as what it is, without throwing", async () => {
    expect(await keepStorageOn({ persisted: async () => false, persist: async () => false })).toBe(false);
    expect(await keepStorageOn(undefined)).toBeNull();
    expect(await keepStorageOn({ persist: async () => Promise.reject(new Error("no")) })).toBeNull();
  });

  it("never asks in a browser, where it may put a prompt in front of the person", async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", { storage: { persist, persisted: async () => false } });
    expect(await keepStorage()).toBeNull();
    expect(persist).not.toHaveBeenCalled();
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    expect(await keepStorage()).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });
});
