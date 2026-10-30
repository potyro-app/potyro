// @vitest-environment happy-dom
//
// The device id the relays count by (#121): random and kept. Where it cannot be kept it is still this
// page's own random id — never one fixed string every such device would share, with one allowance.

import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceId, resetDeviceIdForTests } from "../src/device-id.js";
import { freeKey } from "../src/free-ai.js";

afterEach(() => {
  vi.unstubAllGlobals();
  resetDeviceIdForTests();
  localStorage.clear();
});

describe("the device id", () => {
  it("is random, kept, and the same on every look", () => {
    const id = deviceId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(localStorage.getItem("potyro:device-id")).toBe(id);
    resetDeviceIdForTests();
    expect(deviceId()).toBe(id);
  });

  it("with no storage to keep it in: this page's own random id, the same all page long, never a shared one", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    const id = deviceId();
    expect(id).not.toBe("unknown-device");
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(deviceId()).toBe(id);
    expect(freeKey()).toBe(`potyro-device:${id}`);
    // Another page (another device) gets another.
    resetDeviceIdForTests();
    expect(deviceId()).not.toBe(id);
  });

  it("with no localStorage at all: still one id for the page", () => {
    vi.stubGlobal("localStorage", undefined);
    const id = deviceId();
    expect(deviceId()).toBe(id);
  });
});
