// @vitest-environment happy-dom
//
// The version log is the safety net under AI editing: if a save doesn't leave a restorable "before",
// a bad edit is permanent. These tests drive the real modules — `saveUserApp` writing to
// localStorage, `recordVersion` writing to a Store — with only the durable-store factory faked
// (OPFS SQLite doesn't exist in Node; MemoryStore implements the same interface).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@potyro/store";

// `openStore` is the one thing that can't run headlessly — swap in the in-memory Store the shell
// itself falls back to in browsers without OPFS.
vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string) => {
    const store = new MemoryStore();
    await store.open(namespace);
    return store;
  },
}));

const { listVersions, recordVersion, clearHistory, resetHistoryStore } = await import("../src/app-history.js");
const { saveUserApp, removeUserApp, getUserApp, lockToRestore } = await import("../src/user-apps.js");

const at = (n: number): string => new Date(Date.UTC(2026, 0, n)).toISOString();

beforeEach(() => {
  globalThis.localStorage.clear();
  resetHistoryStore();
});

describe("recordVersion", () => {
  it("numbers versions from 1 and returns them newest first", async () => {
    await recordVersion("notes", { source: "one", origin: "created" }, at(1));
    await recordVersion("notes", { source: "two", origin: "edited", note: "add a tag" }, at(2));

    const versions = await listVersions("notes");
    expect(versions.map((v) => [v.seq, v.source, v.origin])).toEqual([
      [2, "two", "edited"],
      [1, "one", "created"],
    ]);
    expect(versions[0].note).toBe("add a tag");
  });

  it("ignores a save that did not change the source", async () => {
    await recordVersion("notes", { source: "same", origin: "created" }, at(1));
    expect(await recordVersion("notes", { source: "same", origin: "edited" }, at(2))).toBeUndefined();
    expect(await listVersions("notes")).toHaveLength(1);
  });

  it("records the baseline first, so an app that predates history still has a 'before'", async () => {
    await recordVersion("notes", { source: "edited", origin: "edited", baseline: "original" }, at(1));
    expect((await listVersions("notes")).map((v) => [v.seq, v.source])).toEqual([
      [2, "edited"],
      [1, "original"],
    ]);
  });

  it("keeps each app's versions separate", async () => {
    await recordVersion("a", { source: "a1", origin: "created" }, at(1));
    await recordVersion("b", { source: "b1", origin: "created" }, at(1));
    expect((await listVersions("a")).map((v) => v.source)).toEqual(["a1"]);
    expect((await listVersions("b")).map((v) => v.source)).toEqual(["b1"]);
  });

  it("never throws when the store is unavailable — an edit must not be lost to a broken log", async () => {
    resetHistoryStore();
    vi.resetModules();
    vi.doMock("../src/open-store.js", () => ({
      openStore: async () => {
        throw new Error("no storage");
      },
    }));
    const broken = await import("../src/app-history.js");
    await expect(broken.recordVersion("notes", { source: "x", origin: "edited" }, at(1))).resolves.toBeUndefined();
    expect(await broken.listVersions("notes")).toEqual([]);
    vi.doUnmock("../src/open-store.js");
    vi.resetModules();
  });
});

describe("saveUserApp", () => {
  it("records a version for every source change, tagged with what caused it", async () => {
    const created = await saveUserApp({ name: "Notes", source: "v1" }, at(1));
    await saveUserApp({ id: created.id, name: "Notes", source: "v2", origin: "edited", note: "add a tag field" }, at(2));

    const versions = await listVersions(created.id);
    expect(versions.map((v) => [v.seq, v.source, v.origin, v.note])).toEqual([
      [2, "v2", "edited", "add a tag field"],
      [1, "v1", "created", undefined],
    ]);
  });

  it("does not record a version when only the name changed", async () => {
    const created = await saveUserApp({ name: "Notes", source: "v1" }, at(1));
    await saveUserApp({ id: created.id, name: "Notebook", source: "v1" }, at(2));
    expect(await listVersions(created.id)).toHaveLength(1);
  });

  it("restores a previous source by saving it as a new version, leaving the log intact", async () => {
    const created = await saveUserApp({ name: "Notes", source: "v1" }, at(1));
    await saveUserApp({ id: created.id, name: "Notes", source: "v2", origin: "edited", note: "broke it" }, at(2));

    const target = (await listVersions(created.id)).find((v) => v.seq === 1)!;
    await saveUserApp(
      { id: created.id, name: "Notes", source: target.source, origin: "restored", note: "rolled back to version 1" },
      at(3),
    );

    expect(getUserApp(created.id)?.source).toBe("v1");
    // Rolling back appends — the version rolled away from is still there to roll forward to.
    expect((await listVersions(created.id)).map((v) => [v.seq, v.source, v.origin])).toEqual([
      [3, "v1", "restored"],
      [2, "v2", "edited"],
      [1, "v1", "created"],
    ]);
  });

  it("forgets an app's history when the app is deleted", async () => {
    const created = await saveUserApp({ name: "Notes", source: "v1" }, at(1));
    await removeUserApp(created.id);
    expect(await listVersions(created.id)).toEqual([]);
  });
});

// A library upgrade (#266) changes no line of the source — only which bytes `chart.js@…` means. It is
// still a change to what runs, so it is a version, and History can show it as a diff of lock.json.
describe("libraries in history", () => {
  const entry = (hex: string, size: number) => ({ file: `.modules/${hex.repeat(64)}.js`, integrity: `sha256-${hex}=`, size });
  const v1 = { "https://esm.sh/chart.js@4.4.0?bundle": entry("a", 100) };
  const v2 = { "https://esm.sh/chart.js@4.4.1?bundle": entry("b", 120) };

  it("records a version when only the lock changed, carrying lock.json", async () => {
    const created = await saveUserApp({ name: "Chart", source: "same", lock: v1 }, at(1));
    await saveUserApp({ id: created.id, name: "Chart", source: "same", lock: v2, origin: "imported", note: "Updated from a file" }, at(2));
    const versions = await listVersions(created.id);
    expect(versions.map((v) => v.seq)).toEqual([2, 1]);
    expect(versions[0]!.lock).toContain("chart.js@4.4.1");
    expect(versions[1]!.lock).toContain("chart.js@4.4.0");
    expect(JSON.parse(versions[0]!.lock!)).toEqual(v2);
  });

  it("keeps the app's own modules out of lock.json: they are not libraries", async () => {
    const created = await saveUserApp({ name: "Piano", source: "s", lock: { ...v1, "src/plan.ts": { file: ".src/plan.ts", integrity: "sha256-c=", size: 3 } } }, at(1));
    expect(Object.keys(JSON.parse((await listVersions(created.id))[0]!.lock!))).toEqual(["https://esm.sh/chart.js@4.4.0?bundle"]);
  });

  it("does not record a version when neither the source nor the libraries changed", async () => {
    const created = await saveUserApp({ name: "Chart", source: "same", lock: v1 }, at(1));
    await saveUserApp({ id: created.id, name: "Chart", source: "same", lock: { ...v1 } }, at(2));
    expect(await listVersions(created.id)).toHaveLength(1);
  });

  it("an app with no libraries keeps no lock.json", async () => {
    const created = await saveUserApp({ name: "Notes", source: "v1" }, at(1));
    expect((await listVersions(created.id))[0]!.lock).toBeUndefined();
  });

  it("restoring a version puts back the libraries it ran with", async () => {
    const created = await saveUserApp({ name: "Chart", source: "same", lock: v1 }, at(1));
    await saveUserApp({ id: created.id, name: "Chart", source: "same", lock: v2 }, at(2));
    const old = (await listVersions(created.id)).find((v) => v.seq === 1)!;
    await saveUserApp({ id: created.id, name: "Chart", source: old.source, lock: lockToRestore(old, getUserApp(created.id)!), origin: "restored" }, at(3));
    expect(getUserApp(created.id)!.lock).toEqual(v1);
    expect(await listVersions(created.id)).toHaveLength(3);
  });

  it("restoring keeps the app's own modules as they are now", async () => {
    const own = { "src/plan.ts": { file: ".src/plan.ts", integrity: "sha256-c=", size: 3 } };
    const created = await saveUserApp({ name: "Chart", source: "same", lock: { ...v1, ...own } }, at(1));
    await saveUserApp({ id: created.id, name: "Chart", source: "same", lock: { ...v2, ...own } }, at(2));
    const old = (await listVersions(created.id)).find((v) => v.seq === 1)!;
    expect(lockToRestore(old, getUserApp(created.id)!)).toEqual({ ...v1, ...own });
  });
});

describe("clearHistory", () => {
  it("removes only the named app's versions", async () => {
    await recordVersion("a", { source: "a1", origin: "created" }, at(1));
    await recordVersion("b", { source: "b1", origin: "created" }, at(1));
    await clearHistory("a");
    expect(await listVersions("a")).toEqual([]);
    expect(await listVersions("b")).toHaveLength(1);
  });
});
