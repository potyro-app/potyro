import { describe, expect, it, vi } from "vitest";
import {
  CapacitorCapabilities,
  stableNotificationId,
  type CapacitorPlugins,
  type ScheduledNotification,
} from "../src/capacitor-capabilities.js";

// A fake plugin set that records calls, so we exercise the adapter logic without a device/WebView.
function fakePlugins() {
  const scheduled: ScheduledNotification[] = [];
  const cancelled: number[] = [];
  const plugins: CapacitorPlugins = {
    Camera: {
      getPhoto: vi.fn(async () => ({ webPath: "capacitor://localhost/_capacitor_file_/photo.jpg" })),
      requestPermissions: vi.fn(async () => ({})),
    },
    Geolocation: {
      getCurrentPosition: vi.fn(async () => ({ coords: { latitude: -23.5, longitude: -46.6 } })),
      requestPermissions: vi.fn(async () => ({})),
    },
    LocalNotifications: {
      requestPermissions: vi.fn(async () => ({ display: "granted" })),
      schedule: vi.fn(async (opts) => {
        scheduled.push(...opts.notifications);
      }),
      cancel: vi.fn(async (opts) => {
        cancelled.push(...opts.notifications.map((n) => n.id));
      }),
      getPending: vi.fn(async () => ({ notifications: scheduled.map((n) => ({ id: n.id, schedule: { at: n.schedule.at.toISOString() }, extra: n.extra })) })),
    },
    Filesystem: { writeFile: vi.fn(async () => ({ uri: "file:///Documents/x" })) },
    Haptics: { vibrate: vi.fn(async () => {}) },
  };
  return { plugins, scheduled, cancelled };
}

const helpers = {
  fetchImpl: async (_input: string) => ({ blob: async () => new Blob(["img"], { type: "image/jpeg" }) }),
  blobToBase64: async (_blob: Blob) => "QkFTRTY0", // "BASE64"
  pickFile: async () => new Blob(["picked"]),
};

describe("CapacitorCapabilities", () => {
  it("schedules EXACT offline notifications and round-trips the string id via extra", async () => {
    const { plugins, scheduled } = fakePlugins();
    const caps = new CapacitorCapabilities(plugins, helpers);

    expect(caps.notifications.supportsExactScheduling).toBe(true); // the deciding native feature

    await caps.notifications.schedule({ id: "plant:42", at: "2026-08-01T09:00:00.000Z", title: "Water Fern", body: "Due now" });
    expect(plugins.LocalNotifications.requestPermissions).toHaveBeenCalled();
    expect(scheduled[0]!.id).toBe(stableNotificationId("plant:42"));
    expect(scheduled[0]!.schedule).toMatchObject({ allowWhileIdle: true });
    expect(scheduled[0]!.schedule.at.toISOString()).toBe("2026-08-01T09:00:00.000Z");
    expect(scheduled[0]!.extra).toEqual({ kartaId: "plant:42", at: "2026-08-01T09:00:00.000Z" });

    const list = await caps.notifications.list();
    expect(list).toEqual([{ id: "plant:42", at: "2026-08-01T09:00:00.000Z" }]); // string id recovered

    await caps.notifications.cancel("plant:42");
    expect(plugins.LocalNotifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: stableNotificationId("plant:42") }] });
  });

  it("reads GPS and captures a photo as a Blob", async () => {
    const { plugins } = fakePlugins();
    const caps = new CapacitorCapabilities(plugins, helpers);

    expect(await caps.geolocation.current()).toEqual({ lat: -23.5, lng: -46.6 });

    const blob = await caps.camera.capture({ source: "camera" });
    expect(plugins.Camera.getPhoto).toHaveBeenCalledWith({ resultType: "uri", source: "CAMERA" });
    expect(blob.type).toBe("image/jpeg");
  });

  it("saves files to Documents as base64 and vibrates with a single duration", async () => {
    const { plugins } = fakePlugins();
    const caps = new CapacitorCapabilities(plugins, helpers);

    await caps.filesystem.save("recipes.karta.zip", new Blob(["data"]));
    expect(plugins.Filesystem.writeFile).toHaveBeenCalledWith({
      path: "recipes.karta.zip",
      data: "QkFTRTY0",
      directory: "DOCUMENTS",
      recursive: true,
    });

    await caps.haptics.vibrate([50, 100, 50]);
    expect(plugins.Haptics.vibrate).toHaveBeenCalledWith({ duration: 50 }); // first of the pattern
  });

  it("derives stable, positive, distinct notification ids", () => {
    expect(stableNotificationId("a")).toBe(stableNotificationId("a"));
    expect(stableNotificationId("a")).not.toBe(stableNotificationId("b"));
    expect(stableNotificationId("plant:42")).toBeGreaterThan(0);
  });
});
