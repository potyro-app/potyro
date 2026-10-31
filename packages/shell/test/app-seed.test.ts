// @vitest-environment happy-dom
//
// An app's sample records (#486): what a Studio-made app keeps of the records its run passed on, how
// they are fitted to the app after it changes (rows that no longer fit are dropped, never repaired),
// and that nothing of the person's own records ever becomes one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityDef } from "potyro";
import { MemoryStore, readAppPackage } from "@potyro/store";
import { seedForVersion, seedThatFits, type AppSeed } from "../src/app-seed.js";
import { shippedPackage } from "../src/app-folder.js";

// History's store is the one thing that cannot run headlessly (app-history.test.ts).
vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string) => {
    const store = new MemoryStore();
    await store.open(namespace);
    return store;
  },
}));
const { getUserApp, refitSeed, saveUserApp } = await import("../src/user-apps.js");

const NOW = "2026-10-31T00:00:00.000Z";

const plants = (over: Partial<Record<string, unknown>> = {}): Record<string, EntityDef> =>
  ({
    plant: {
      label: "Plant",
      fields: {
        name: { type: "text", required: true },
        light: { type: "enum", options: ["sun", "shade"] },
        photo: { type: "media" },
        ...over,
      },
    },
    watering: {
      label: "Watering",
      fields: {
        plant: { type: "relation", to: "plant", required: true },
        amount: { type: "number", min: 0 },
      },
    },
  }) as never;

const seed: AppSeed = {
  plant: [
    { id: "p1", name: "Monstera", light: "shade" },
    { id: "p2", name: "Lemon tree", light: "sun", photo: { file: "photos/lemon.webp" } },
  ],
  watering: [
    { id: "w1", plant: "p1", amount: 2 },
    { id: "w2", plant: "p2", amount: 1 },
  ],
};

describe("a seed fitted to the app as it is now", () => {
  it("keeps every row that still fits, a photo named by the file it shipped with included", () => {
    expect(seedThatFits(seed, plants())).toEqual(seed);
  });

  it("drops a row whose value its field no longer allows, and a row that pointed at it, required, goes too", () => {
    // The modify took "sun" out of the options: the lemon tree no longer fits, nor its watering.
    const fitted = seedThatFits(seed, plants({ light: { type: "enum", options: ["shade", "bright"] } }));
    expect(fitted).toEqual({ plant: [seed.plant![0]], watering: [seed.watering![0]] });
  });

  it("drops a row that lacks a field the app now requires, but not for a photo, which cannot be made up", () => {
    const fitted = seedThatFits(seed, plants({ room: { type: "text", required: true } }));
    expect(fitted).toBeUndefined();
    expect(seedThatFits(seed, plants({ photo: { type: "media", required: true } }))?.plant).toHaveLength(2);
  });

  it("takes out a field the app no longer has, and an entity it no longer keeps, and keeps the rest", () => {
    const entities = plants();
    delete (entities.plant!.fields as Record<string, unknown>).light;
    const fitted = seedThatFits({ ...seed, gone: [{ id: "g1", x: 1 }] }, { plant: entities.plant! });
    expect(fitted).toEqual({ plant: [{ id: "p1", name: "Monstera" }, { id: "p2", name: "Lemon tree", photo: { file: "photos/lemon.webp" } }] });
  });

  it("takes out a reference to a dropped row where the reference is not required", () => {
    const entities = plants({ light: { type: "enum", options: ["shade"] } });
    (entities.watering!.fields as Record<string, unknown>).plant = { type: "relation", to: "plant" };
    expect(seedThatFits(seed, entities)?.watering).toEqual([{ id: "w1", plant: "p1", amount: 2 }, { id: "w2", amount: 1 }]);
  });

  it("leaves a reference to a record the seed never had: one the app makes itself", () => {
    const fitted = seedThatFits({ watering: [{ id: "w9", plant: "made-by-the-app", amount: 1 }] }, plants());
    expect(fitted?.watering?.[0]?.plant).toBe("made-by-the-app");
  });

  it("judges a list's rows one sub-field at a time, a photo in a row named by its file", () => {
    const entities = { log: { label: "Log", fields: { sets: { type: "list", of: { reps: { type: "number" }, photo: { type: "media" } } } } } } as never;
    const rows = { log: [{ id: "l1", sets: [{ reps: 5, photo: { file: "a.webp" } }] }, { id: "l2", sets: [{ reps: "five" }] }] };
    expect(seedThatFits(rows, entities)).toEqual({ log: [rows.log[0]] });
  });
});

describe("the seed saved with a version", () => {
  it("a new app's is the one its run passed on, fitted", () => {
    expect(seedForVersion({ isNew: true, made: seed, entities: plants() })).toEqual(seed);
  });

  it("a changed app keeps the rows of its own that fit, never the run's", () => {
    const run: AppSeed = { plant: [{ id: "x", name: "name 1" }] };
    expect(seedForVersion({ isNew: false, prev: seed, made: run, entities: plants() })).toEqual(seed);
    // None of them fits any more: the seed goes, and is not replaced by anything.
    expect(seedForVersion({ isNew: false, prev: seed, made: run, entities: plants({ name: { type: "number", required: true } }) })).toBeNull();
    expect(seedForVersion({ isNew: false, made: run, entities: plants() })).toBeNull();
  });

  it("a version that did not build leaves the seed as it was", () => {
    expect(seedForVersion({ isNew: false, prev: seed, entities: undefined })).toBeUndefined();
  });
});

describe("a saved app's seed", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("is taken away when the version says null, and kept when it says nothing", async () => {
    await saveUserApp({ id: "watering", name: "Watering", source: "s1", seed }, NOW);
    await saveUserApp({ id: "watering", name: "Watering", source: "s2" }, NOW);
    expect(getUserApp("watering")?.seed).toEqual(seed);
    await saveUserApp({ id: "watering", name: "Watering", source: "s3", seed: null }, NOW);
    expect(getUserApp("watering")?.seed).toBeUndefined();
  });

  it("is refitted as the app opens: rows that no longer fit are dropped, nothing is added", async () => {
    await saveUserApp({ id: "watering", name: "Watering", source: "s1", seed }, NOW);
    refitSeed("watering", plants({ light: { type: "enum", options: ["shade"] } }));
    expect(getUserApp("watering")?.seed).toEqual({ plant: [seed.plant![0]], watering: [seed.watering![0]] });
    refitSeed("watering", plants({ name: { type: "number", required: true } }));
    expect(getUserApp("watering")?.seed).toBeUndefined();
    // An app with no seed gets none from refitting.
    refitSeed("watering", plants());
    expect(getUserApp("watering")?.seed).toBeUndefined();
  });

  it("is what a package saved from the app carries as seed.json — never the person's records in its store", async () => {
    const store = new MemoryStore();
    await store.open("user:watering");
    await store.insert("plant", { name: "My own fig, kitchen window" } as never);
    const zip = await shippedPackage(store, { source: "export default 1", lock: undefined, seed });
    expect(readAppPackage(zip).seed).toEqual(seed);
    expect(JSON.stringify(readAppPackage(zip).seed)).not.toContain("My own fig");
    // An app with no sample records saves a package without any: its store is not read for them.
    expect(readAppPackage(await shippedPackage(store, { source: "export default 1", lock: undefined })).seed).toBeUndefined();
  });
});
