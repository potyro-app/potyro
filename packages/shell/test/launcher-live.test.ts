import { describe, expect, it } from "vitest";
import { LIVE_CAP, liveCandidates } from "../src/launcher-live.js";
import type { InstalledApp } from "../src/launcher-store.js";

// Which synced apps the home screen watches live (#86 phase 2): only synced apps this device has
// opened, most recently opened first, at most LIVE_CAP of them.

const app = (id: string, sync: boolean, lastOpenedAt?: string, openCount?: number): InstalledApp =>
  ({ id, key: `user:${id}`, kind: "user", name: id, sync, trusted: true, people: [], entry: { key: `user:${id}`, lastOpenedAt, openCount }, user: { id } }) as unknown as InstalledApp;

describe("liveCandidates", () => {
  it("keeps synced, opened apps, newest first, capped", () => {
    const apps = [
      app("local", false, "2026-09-15T10:00:00Z", 3),
      app("never", true),
      app("old", true, "2026-09-01T00:00:00Z", 1),
      app("new", true, "2026-09-14T00:00:00Z", 2),
      ...Array.from({ length: LIVE_CAP + 2 }, (_, i) => app(`s${i}`, true, `2026-08-${String(10 + i).padStart(2, "0")}T00:00:00Z`, 1)),
    ];
    const picked = liveCandidates(apps).map((a) => a.id);
    expect(picked).toHaveLength(LIVE_CAP);
    expect(picked.slice(0, 2)).toEqual(["new", "old"]);
    expect(picked).not.toContain("local");
    expect(picked).not.toContain("never");
  });
});
