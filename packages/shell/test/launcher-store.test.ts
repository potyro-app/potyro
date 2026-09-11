// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureIdentities, getEntry, listInstalledApps, recordOpen, removeEntry, sourceHash, subscribe, updateEntry } from "../src/launcher-store.js";
import { removeUserApp, saveUserApp } from "../src/user-apps.js";

// The launcher store (#81): what this device knows about each installed app.

vi.mock("../src/app-history.js", () => ({ recordVersion: async () => {}, clearHistory: async () => {} }));
vi.mock("../src/app-diagnoses.js", () => ({ clearDiagnoses: async () => {} }));
vi.mock("../src/app-cases.js", () => ({ clearCases: async () => {} }));

const NOW = "2026-09-11T12:00:00.000Z";
const LATER = "2026-09-11T13:00:00.000Z";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("launcher store", () => {
  it("round-trips an entry and merges patches immutably", () => {
    expect(getEntry("user:groceries")).toEqual({ key: "user:groceries" });
    const a = updateEntry("user:groceries", { pinned: true, displayName: "Food" });
    const b = updateEntry("user:groceries", { displayName: undefined });
    expect(a).toEqual({ key: "user:groceries", pinned: true, displayName: "Food" });
    expect(b).toEqual({ key: "user:groceries", pinned: true }); // undefined removes; `a` untouched
    expect(a.displayName).toBe("Food");
    expect(JSON.parse(localStorage.getItem("karta:launcher")!)).toEqual({ "user:groceries": { key: "user:groceries", pinned: true } });
  });

  it("tolerates garbage in storage", async () => {
    await saveUserApp({ id: "recipes", name: "Recipes", source: "export default 1" }, NOW); // so its entry is live, not pruned
    for (const junk of ["not json", "[1,2]", "null", '{"nope":{"pinned":true},"user:x":null,"user:recipes":{"openCount":3}}']) {
      localStorage.setItem("karta:launcher", junk);
      expect(() => listInstalledApps()).not.toThrow();
      expect(getEntry("user:plants")).toEqual({ key: "user:plants" });
    }
    // The one well-formed entry in the last blob survived the junk around it.
    expect(getEntry("user:recipes").openCount).toBe(3);
  });

  it("recordOpen increments the count and stamps the time", () => {
    recordOpen("user:recipes", NOW);
    recordOpen("user:recipes", LATER);
    expect(getEntry("user:recipes")).toEqual({ key: "user:recipes", openCount: 2, lastOpenedAt: LATER });
  });

  it("lists the apps, newest first, joined with their entries", async () => {
    await saveUserApp({ name: "Groceries", source: "export default 1" }, NOW);
    await saveUserApp({ name: "Garden", source: "export default 1", trusted: false }, LATER);
    updateEntry("user:groceries", { displayName: "Food", pinned: true });
    const apps = listInstalledApps();
    expect(apps.map((a) => a.key)).toEqual(["user:garden", "user:groceries"]);
    const groceries = apps.find((a) => a.key === "user:groceries")!;
    expect(groceries).toMatchObject({ kind: "user", id: "groceries", name: "Food", trusted: true, sync: false, entry: { pinned: true } });
    expect(groceries.user?.name).toBe("Groceries"); // the app's own name is still there
    expect(apps.find((a) => a.key === "user:garden")).toMatchObject({ name: "Garden", trusted: false });
  });

  it("drops the entry of a user app that was deleted", async () => {
    await saveUserApp({ name: "Trips", source: "export default 1" }, NOW);
    recordOpen("user:trips", NOW);
    await removeUserApp("trips");
    expect(listInstalledApps().some((a) => a.key === "user:trips")).toBe(false);
    expect(localStorage.getItem("karta:launcher")).not.toContain("user:trips");
    removeEntry("user:recipes"); // absent: a no-op, not an error
  });

  it("tells subscribers about writes to either registry", async () => {
    const seen = vi.fn();
    const off = subscribe(seen);
    recordOpen("user:plants", NOW);
    expect(seen).toHaveBeenCalledTimes(1);
    await saveUserApp({ name: "Books", source: "export default 1" }, NOW);
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    recordOpen("user:plants", LATER);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

// #82: the declared identity, read from the source and cached against its hash.
describe("launcher store: identity", () => {
  const SOURCE = (name: string, extra = "") =>
    `import { defineApp } from "karta";\nexport default defineApp({ id: "g", name: ${JSON.stringify(name)}, ${extra} version: "1.0.0", schemaVersion: 1, entities: {}, pages: [] });`;

  it("reads a user app's declared name, icon and accent once, and again only when the source changes", async () => {
    await saveUserApp({ id: "g", name: "Groceries", source: SOURCE("Grocery run", 'icon: "🛒", theme: { accent: "#123456" },') }, NOW);
    const before = listInstalledApps().find((a) => a.key === "user:g")!;
    expect(before.name).toBe("Groceries");
    expect(before.icon).toBeUndefined();
    await ensureIdentities(listInstalledApps());
    const read = listInstalledApps().find((a) => a.key === "user:g")!;
    expect(read).toMatchObject({ name: "Groceries", icon: "🛒", accent: "#123456" });
    expect(read.entry.identity?.name).toBe("Grocery run"); // read and kept; the record's own name is what the tile says
    expect(read.entry.identity?.hash).toBe(sourceHash(read.user!.source));

    // The user's own name for it wins over the declared one.
    updateEntry("user:g", { displayName: "Food" });
    expect(listInstalledApps().find((a) => a.key === "user:g")!.name).toBe("Food");
    updateEntry("user:g", { displayName: undefined });

    // A new version of the source: the old identity no longer applies, and the new one is read.
    await saveUserApp({ id: "g", name: "Groceries", source: SOURCE("Weekly shop") }, LATER);
    expect(listInstalledApps().find((a) => a.key === "user:g")!.name).toBe("Groceries"); // stale cache ignored
    await ensureIdentities(listInstalledApps());
    const after = listInstalledApps().find((a) => a.key === "user:g")!;
    expect(after.entry.identity?.name).toBe("Weekly shop");
    expect(after.icon).toBeUndefined();
    expect(after.accent).toBeUndefined();
  });

});
