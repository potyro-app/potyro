import { describe, expect, it } from "vitest";
import { frecency, moveKey, orderApps } from "../src/launcher-order.js";
import type { InstalledApp, LauncherEntry } from "../src/launcher-store.js";

// The launcher's order (#84), with the clock held still.

const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const app = (id: string, name: string, entry: Partial<LauncherEntry> = {}): InstalledApp =>
  ({ key: `user:${id}`, kind: "user", id, name, trusted: true, sync: false, entry: { key: `user:${id}`, ...entry }, user: { id, name, source: "", updatedAt: "" } }) as InstalledApp;

describe("frecency", () => {
  it("is zero for an app never opened, and grows with opens", () => {
    expect(frecency({}, NOW)).toBe(0);
    expect(frecency({ openCount: 0, lastOpenedAt: ago(1) }, NOW)).toBe(0);
    expect(frecency({ openCount: 2, lastOpenedAt: ago(1) }, NOW)).toBe(2 * frecency({ openCount: 1, lastOpenedAt: ago(1) }, NOW));
  });

  it("weights recency in buckets: this morning beats last week, however often", () => {
    const today = frecency({ openCount: 1, lastOpenedAt: ago(2) }, NOW);
    const yesterday = frecency({ openCount: 1, lastOpenedAt: ago(20) }, NOW);
    const lastWeek = frecency({ openCount: 3, lastOpenedAt: ago(6 * 24) }, NOW);
    const lastMonth = frecency({ openCount: 12, lastOpenedAt: ago(20 * 24) }, NOW);
    const ages = frecency({ openCount: 30, lastOpenedAt: ago(200 * 24) }, NOW);
    expect(today).toBeGreaterThan(yesterday);
    expect(today).toBeGreaterThan(lastWeek); // 100 vs 90
    expect(lastMonth).toBeGreaterThan(lastWeek); // 120 vs 90: twelve opens still count
    expect(ages).toBe(150);
  });

  it("ignores a stamp it cannot read", () => {
    expect(frecency({ openCount: 5, lastOpenedAt: "not a date" }, NOW)).toBe(0);
  });
});

describe("orderApps", () => {
  const apps = [
    app("trips", "Trips", { openCount: 1, lastOpenedAt: ago(1) }),
    app("books", "Books", { openCount: 2, lastOpenedAt: ago(1) }),
    app("garden", "Garden", { pinned: true, order: 1 }),
    app("tasks", "Tasks", { pinned: true, order: 0, openCount: 9, lastOpenedAt: ago(1) }),
    app("piano", "Piano practice"),
    app("zoo", "Zoo", { order: 0 }),
  ];
  const keys = (list: InstalledApp[]) => list.map((a) => a.id);

  it("puts pinned apps first, in their own order, whatever the mode", () => {
    for (const mode of ["recent", "az", "manual"] as const) expect(keys(orderApps(apps, mode, NOW).pinned)).toEqual(["tasks", "garden"]);
  });

  it("recent: by frecency, then by name for the never-opened", () => {
    expect(keys(orderApps(apps, "recent", NOW).rest)).toEqual(["books", "trips", "piano", "zoo"]);
  });

  it("az: by name, case-insensitively", () => {
    expect(keys(orderApps(apps, "az", NOW).rest)).toEqual(["books", "piano", "trips", "zoo"]);
  });

  it("manual: by the order you gave, the rest after it by name", () => {
    expect(keys(orderApps(apps, "manual", NOW).rest)).toEqual(["zoo", "books", "piano", "trips"]);
  });
});

describe("moveKey", () => {
  const list = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
  it("moves a key to a position, clamped, and leaves the rest in order", () => {
    expect(moveKey(list, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveKey(list, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveKey(list, "b", 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveKey(list, "b", -3)).toEqual(["b", "a", "c", "d"]);
  });
  it("is a no-op for an unknown key or the same position", () => {
    expect(moveKey(list, "zz", 1)).toEqual(["a", "b", "c", "d"]);
    expect(moveKey(list, "c", 2)).toEqual(["a", "b", "c", "d"]);
  });
});
