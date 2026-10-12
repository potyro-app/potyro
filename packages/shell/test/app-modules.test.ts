// @vitest-environment happy-dom
//
// A copy of an app with libraries (#266) or its own modules (#258) is a copy of its CODE too: the
// lock on its record and the files it names, in the copy's own folder. Without them the copy opens
// to "chart.js 4.4.1 is not part of this app yet".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileSpace, lockEntryFor, MemoryStore, moduleFileFor, type Store } from "@potyro/store";

const stores = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-store.js", async () => {
  const { MemoryStore: Memory } = await import("@potyro/store");
  return {
    openAppStore: async (app: { id: string }) => {
      if (!stores.has(app.id)) {
        const s = new Memory();
        await s.open(app.id);
        stores.set(app.id, s);
      }
      // Closing a copy's handle must not lose what was written: hand out a view that ignores close.
      return new Proxy(stores.get(app.id) as object, { get: (t, k) => (k === "close" ? async () => {} : Reflect.get(t, k)) });
    },
    syncAllowedFor: async () => false,
  };
});

const { saveUserApp, getUserApp } = await import("../src/user-apps.js");
const { duplicateApp, modulesOf } = await import("../src/app-modules.js");

const enc = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
  localStorage.clear();
  stores.clear();
});

describe("duplicating an app with code beyond its source", () => {
  it("the copy gets the lock and its own copy of every file the lock names", async () => {
    const lib = enc("export const chart = 1;");
    const file = await moduleFileFor(lib);
    const lock = {
      "https://esm.sh/chart.js@4.4.1?bundle": await lockEntryFor(file, lib),
      "src/plan.ts": await lockEntryFor(".src/plan.ts", enc("export const n = 1;")),
    };
    await saveUserApp({ id: "chart", name: "Chart", source: "src", lock }, "2026-10-12T00:00:00Z");
    const original = (await (await import("../src/app-store.js")).openAppStore(getUserApp("chart")!, { sync: false })) as Store;
    await fileSpace(original).write(file, new Blob([lib]), { origin: "shipped" });
    await fileSpace(original).write(".src/plan.ts", new Blob(["export const n = 1;"]), { origin: "shipped" });

    const copy = (await duplicateApp("chart", "2026-10-12T00:00:01Z"))!;
    expect(copy.id).not.toBe("chart");
    expect(getUserApp(copy.id)!.lock).toEqual(lock);
    const modules = (await modulesOf(copy.id))!;
    expect(new TextDecoder().decode((await modules.read(file))!)).toBe("export const chart = 1;");
    expect(new TextDecoder().decode((await modules.read(".src/plan.ts"))!)).toBe("export const n = 1;");
    // ...and it is the copy's folder, not a view of the original's.
    expect(stores.get(copy.id)).toBeInstanceOf(MemoryStore);
  });

  it("an app that is one file copies as before", async () => {
    await saveUserApp({ id: "notes", name: "Notes", source: "src" }, "2026-10-12T00:00:00Z");
    const copy = (await duplicateApp("notes", "2026-10-12T00:00:01Z"))!;
    expect(getUserApp(copy.id)!.lock).toBeUndefined();
    expect(stores.has(copy.id)).toBe(false);
  });
});
