// @vitest-environment happy-dom
//
// "If my laptop dies I just lost all my apps and data!" — this is the switch that makes that untrue,
// so what it claims has to be exactly what happened. In particular: it may only say a device is
// backing everything up once every app is actually in a space, and an app that fails to move must
// not take the others with it or be quietly counted as moved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const moved: string[] = [];
const failures = new Map<string, string>();

vi.mock("../src/toggle-sync.js", () => ({
  toggleAppSync: async (appId: string) => {
    const reason = failures.get(appId);
    if (reason) throw new Error(reason);
    moved.push(appId);
    const { setUserAppSync } = await import("../src/user-apps.js");
    setUserAppSync(appId, true, new Date().toISOString());
    return { copied: { records: 3, kv: 0, blobs: 0, skippedBlobs: [] }, warnings: [] };
  },
}));

vi.mock("../src/app-source.js", () => ({
  inspect: async () => ({ entities: [{ key: "item" }] }),
}));

vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-diagnoses.js", () => ({ clearDiagnoses: async () => {} }));
vi.mock("../src/app-cases.js", () => ({ clearCases: async () => {} }));

const { backupEnabled, setBackupEnabled, enrolEveryApp, localOnlyApps } = await import("../src/backup-all.js");
const { saveUserApp, setUserAppSync, getUserApp } = await import("../src/user-apps.js");

const NOW = "2026-09-19T12:00:00.000Z";

beforeEach(async () => {
  localStorage.clear();
  moved.length = 0;
  failures.clear();
  await saveUserApp({ id: "groceries", name: "Groceries", source: "// g\n", trusted: true }, NOW);
  await saveUserApp({ id: "places", name: "Places", source: "// p\n", trusted: true }, NOW);
  await saveUserApp({ id: "notes", name: "Notes", source: "// n\n", trusted: true }, NOW);
});
afterEach(() => localStorage.clear());

describe("backing up every app", () => {
  it("is off until it is asked for", () => {
    expect(backupEnabled()).toBe(false);
  });

  it("moves the apps that are still local-only, and leaves the rest alone", async () => {
    setUserAppSync("places", true, NOW); // already where it needs to be
    expect(localOnlyApps().map((a) => a.id).sort()).toEqual(["groceries", "notes"]);

    const result = await enrolEveryApp();

    expect(moved.sort()).toEqual(["groceries", "notes"]);
    expect(result.moved).toBe(2);
    expect(result.records).toBe(6);
    expect(getUserApp("groceries")?.sync).toBe(true);
    expect(getUserApp("notes")?.sync).toBe(true);
  });

  it("reports progress by name, so a long move is legible", async () => {
    const seen: string[] = [];
    await enrolEveryApp((p) => seen.push(`${p.done}/${p.total} ${p.name}`));

    expect(seen).toHaveLength(3);
    expect(seen[0]).toMatch(/^1\/3 /);
    expect(seen[2]).toMatch(/^3\/3 /);
  });

  it("carries on past an app that will not move, and says which", async () => {
    failures.set("places", "its photos would not copy");

    const result = await enrolEveryApp();

    // The other two still made it.
    expect(moved.sort()).toEqual(["groceries", "notes"]);
    expect(result.moved).toBe(2);
    expect(result.failed).toEqual([{ name: "Places", reason: "its photos would not copy" }]);
    // And the one that failed is untouched, not half-moved.
    expect(getUserApp("places")?.sync).toBeFalsy();
  });

  it("only claims to be backing everything up once nothing is left behind", async () => {
    failures.set("places", "no");
    const result = await enrolEveryApp();
    // The caller is responsible for the flag; this pins what it has to decide on.
    expect(result.failed).toHaveLength(1);
    expect(localOnlyApps()).toHaveLength(1);

    failures.clear();
    await enrolEveryApp();
    expect(localOnlyApps()).toHaveLength(0);
    setBackupEnabled(true);
    expect(backupEnabled()).toBe(true);
  });
});
