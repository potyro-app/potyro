// iOS keeps 64 pending local notifications per app and drops the rest without an error (docs/27 §3).
// The reconciler schedules one per record per reminder, across every app, so which 64 survive must
// be decided here: the soonest ones.
import { describe, expect, it, vi } from "vitest";
import { CapacitorCapabilities, IOS_PENDING_LIMIT, makeRoom, type CapacitorPlugins, type ScheduledNotification } from "../src/capacitor-capabilities.js";

describe("makeRoom", () => {
  const held = (...ats: number[]) => ats.map((at, i) => ({ id: i + 1, at }));

  it("takes anything while there is room", () => {
    expect(makeRoom(held(10, 20), 99, 3)).toEqual({ keep: true, drop: [] });
  });

  it("pushes the latest out for a sooner one", () => {
    expect(makeRoom(held(10, 30, 20), 15, 3)).toEqual({ keep: true, drop: [2] });
  });

  it("lets a later one wait rather than push out a sooner one", () => {
    expect(makeRoom(held(10, 30, 20), 40, 3)).toEqual({ keep: false, drop: [] });
    expect(makeRoom(held(10, 30, 20), 30, 3).keep).toBe(false); // a tie keeps what is there
  });

  it("treats a pending one with no readable time as the latest", () => {
    expect(makeRoom(held(10, Number.NaN, 20), 25, 3)).toEqual({ keep: true, drop: [2] });
  });

  it("drops enough to get back under the limit when the OS somehow holds more", () => {
    expect(makeRoom(held(10, 50, 40, 20), 15, 3)).toEqual({ keep: true, drop: [2, 3] });
  });
});

/** The OS's pending list as iOS keeps it: by id, rescheduling replaces. */
function osLike() {
  const pending = new Map<number, ScheduledNotification>();
  const plugins: CapacitorPlugins = {
    Camera: { getPhoto: vi.fn() },
    Geolocation: { getCurrentPosition: vi.fn() },
    LocalNotifications: {
      requestPermissions: vi.fn(async () => ({ display: "granted" })),
      schedule: vi.fn(async ({ notifications }) => void notifications.forEach((n) => pending.set(n.id, n))),
      cancel: vi.fn(async ({ notifications }) => void notifications.forEach((n) => pending.delete(n.id))),
      getPending: vi.fn(async () => ({
        notifications: [...pending.values()].map((n) => ({ id: n.id, schedule: { at: n.schedule.at.toISOString() }, extra: n.extra })),
      })),
    },
    Filesystem: { writeFile: vi.fn() },
    Haptics: { vibrate: vi.fn() },
  };
  return { plugins, pending };
}

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 16, 9, minutes)).toISOString();

describe("scheduling past iOS's limit", () => {
  it("ends with the soonest ones pending, whatever order they were scheduled in", async () => {
    const { plugins, pending } = osLike();
    const caps = new CapacitorCapabilities(plugins, { maxPendingNotifications: 3, liveCamera: null });
    for (const m of [40, 10, 50, 20, 30]) await caps.notifications.schedule({ id: `task:${m}`, at: at(m), title: `t${m}` });
    const kept = (await caps.notifications.list()).map((n) => n.id).sort();
    expect(kept).toEqual(["task:10", "task:20", "task:30"]);
    expect(pending.size).toBe(3);
  });

  it("rescheduling one already pending replaces it instead of counting twice", async () => {
    const { plugins, pending } = osLike();
    const caps = new CapacitorCapabilities(plugins, { maxPendingNotifications: 2, liveCamera: null });
    await caps.notifications.schedule({ id: "a", at: at(10), title: "a" });
    await caps.notifications.schedule({ id: "b", at: at(20), title: "b" });
    await caps.notifications.schedule({ id: "b", at: at(25), title: "b, moved" });
    expect(pending.size).toBe(2);
    expect((await caps.notifications.list()).find((n) => n.id === "b")?.at).toBe(at(25));
  });

  it("is not applied where there is no limit to manage (Android)", async () => {
    const { plugins, pending } = osLike();
    const caps = new CapacitorCapabilities(plugins, { liveCamera: null });
    for (let m = 0; m < IOS_PENDING_LIMIT + 6; m++) await caps.notifications.schedule({ id: `n${m}`, at: at(m), title: "x" });
    expect(pending.size).toBe(IOS_PENDING_LIMIT + 6);
    expect(plugins.LocalNotifications.getPending).not.toHaveBeenCalled();
  });
});
