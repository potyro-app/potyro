import { describe, expect, it } from "vitest";
import { FakeCapabilities } from "../src/index.js";

describe("FakeCapabilities", () => {
  it("provides camera/geo/notifications by default and omits when disabled", () => {
    const caps = new FakeCapabilities();
    expect(caps.camera).not.toBeNull();
    expect(caps.geolocation).not.toBeNull();
    expect(caps.notifications).not.toBeNull();

    const stripped = new FakeCapabilities({ camera: false, geolocation: false, notifications: false });
    expect(stripped.camera).toBeNull();
    expect(stripped.geolocation).toBeNull();
    expect(stripped.notifications).toBeNull();
  });

  it("is offline by default (network.fetch throws)", async () => {
    const caps = new FakeCapabilities();
    await expect(caps.network.fetch("https://example.com")).rejects.toThrow(/offline/);
  });

  it("delegates network.fetch when configured", async () => {
    const caps = new FakeCapabilities({ fetch: async () => new Response("ok") });
    const res = await caps.network.fetch("https://example.com");
    expect(await res.text()).toBe("ok");
  });

  it("records scheduled notifications", async () => {
    const caps = new FakeCapabilities();
    await caps.notifications!.schedule({ id: "n1", at: "2026-01-01T00:00:00Z", title: "Hi" });
    expect(await caps.notifications!.list()).toEqual([{ id: "n1", at: "2026-01-01T00:00:00Z" }]);
    await caps.notifications!.cancel("n1");
    expect(await caps.notifications!.list()).toEqual([]);
  });

  it("returns a fixed geo position", async () => {
    const caps = new FakeCapabilities({ position: { lat: 1, lng: 2 } });
    expect(await caps.geolocation!.current()).toEqual({ lat: 1, lng: 2 });
  });

  it("records haptics vibrations and can be disabled", async () => {
    const caps = new FakeCapabilities();
    await caps.haptics!.vibrate(35);
    await caps.haptics!.vibrate([0, 250, 120, 250]);
    expect(caps.vibrations).toEqual([35, [0, 250, 120, 250]]);

    expect(new FakeCapabilities({ haptics: false }).haptics).toBeNull();
  });
});
