import { describe, it, vi } from "vitest";
import { CONFORMANCE_CHECKS, type TargetExpectations } from "@potyro/capabilities";
import { CapacitorCapabilities, type CapacitorPlugins, type ScheduledNotification } from "../src/capacitor-capabilities.js";

// The shared capability spec (docs/09), run against the NATIVE target — the same list that runs
// against the web target in `packages/capabilities/test/conformance-web.test.ts`. Over fake plugins
// rather than a device: what a device alone can prove (a notification firing with the app closed) is
// the device checklist in docs/13. What this proves is that the two targets cannot silently diverge
// on the contract the runtime is written against.

function fakePlugins(): CapacitorPlugins {
  const scheduled: ScheduledNotification[] = [];
  return {
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
      schedule: vi.fn(async (opts) => void scheduled.push(...opts.notifications)),
      cancel: vi.fn(async (opts) => {
        for (const { id } of opts.notifications) {
          const at = scheduled.findIndex((n) => n.id === id);
          if (at >= 0) scheduled.splice(at, 1);
        }
      }),
      getPending: vi.fn(async () => ({
        notifications: scheduled.map((n) => ({ id: n.id, schedule: { at: n.schedule.at.toISOString() }, extra: n.extra })),
      })),
    },
    Filesystem: { writeFile: vi.fn(async () => ({ uri: "file:///Documents/x" })) },
    Haptics: { vibrate: vi.fn(async () => {}) },
  };
}

const helpers = {
  fetchImpl: async () => ({ blob: async () => new Blob(["img"], { type: "image/jpeg" }) }),
  blobToBase64: async () => "QkFTRTY0",
  pickFile: async () => new Blob(["picked"]),
};

const native: TargetExpectations = {
  // The deciding native feature: an exact, offline, app-closed reminder (business plan §8.3).
  exactScheduling: true,
};

describe("capability conformance — native (Capacitor)", () => {
  for (const check of CONFORMANCE_CHECKS) {
    it(check.name, async () => {
      await check.run(new CapacitorCapabilities(fakePlugins(), helpers), native);
    });
  }
});
