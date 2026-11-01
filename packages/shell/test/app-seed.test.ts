// @vitest-environment happy-dom
//
// An app's sample records (#486): fitted at the point of USE — a demo link, a package, a demo opening —
// against the definition at hand, by the rule the store's write gate holds every record to; never
// narrowed where they are kept, so a later version or a History rollback never loses one. A Studio
// app's are the model's sample records, checked row by row; nothing of the person's records is one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityDef } from "potyro";
import { MemoryStore, readAppPackage } from "@potyro/store";
import { sampleSeed, seedThatFits, type AppSeed } from "../src/app-seed.js";
import { shippedPackage } from "../src/app-folder.js";

// History's store is the one thing that cannot run headlessly (app-history.test.ts).
vi.mock("../src/open-store.js", () => ({
  openStore: async (namespace: string) => {
    const store = new MemoryStore();
    await store.open(namespace);
    return store;
  },
}));
const { getUserApp, MAX_KEPT_SEED, saveUserApp } = await import("../src/user-apps.js");
const { listVersions } = await import("../src/app-history.js");
const { restoreVersion } = await import("../src/restore-version.js");

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

  it("drops a row whose value its field no longer allows, and takes the reference to it out of the rows that pointed at it", () => {
    // The modify took "sun" out of the options: the lemon tree no longer fits. Its watering stays —
    // the store takes a record without its plant — with the plant taken out.
    const fitted = seedThatFits(seed, plants({ light: { type: "enum", options: ["shade", "bright"] } }));
    expect(fitted).toEqual({ plant: [seed.plant![0]], watering: [seed.watering![0], { id: "w2", amount: 1 }] });
  });

  it("drops a row the gate refuses for min and max, as the store's write gate does", () => {
    const entities = plants();
    (entities.watering!.fields as Record<string, unknown>).amount = { type: "number", min: 0, max: 1 };
    expect(seedThatFits(seed, entities)?.watering).toEqual([seed.watering![1]]);
  });

  it("never asks whether a field is required — the store does not — with a default or without", () => {
    // The app now requires a room, with a default or not: the store takes the rows without it all the same.
    expect(seedThatFits(seed, plants({ room: { type: "text", required: true } }))).toEqual(seed);
    expect(seedThatFits(seed, plants({ room: { type: "text", required: true, default: "Kitchen" } }))).toEqual(seed);
  });

  it("takes out a field the app no longer has, and an entity it no longer keeps, and keeps the rest", () => {
    const entities = plants();
    delete (entities.plant!.fields as Record<string, unknown>).light;
    const fitted = seedThatFits({ ...seed, gone: [{ id: "g1", x: 1 }] }, { plant: entities.plant! });
    expect(fitted).toEqual({ plant: [{ id: "p1", name: "Monstera" }, { id: "p2", name: "Lemon tree", photo: { file: "photos/lemon.webp" } }] });
  });

  it("takes a dropped row out of a list of references, and leaves an empty list as it was", () => {
    const entities = plants({ light: { type: "enum", options: ["shade"] } });
    (entities.watering!.fields as Record<string, unknown>).plant = { type: "relation", to: "plant", many: true };
    const fitted = seedThatFits({ ...seed, watering: [{ id: "w1", plant: ["p1", "p2"] }, { id: "w2", plant: ["p2"] }] }, entities);
    expect(fitted?.watering).toEqual([{ id: "w1", plant: ["p1"] }, { id: "w2", plant: [] }]);
    expect(seedThatFits({ watering: [{ id: "w3", plant: [] }] }, entities)?.watering).toEqual([{ id: "w3", plant: [] }]);
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

describe("a Studio app's sample records, from the model's reply", () => {
  const reply = {
    plant: [
      { id: "plant-1", name: "Monstera by the window", light: "shade", photo: "https://example.com/m.jpg" },
      { id: "plant-2", name: "Lemon tree", light: "sun" },
      { id: "plant-3", name: "Basil", light: "full sun" },
    ],
    watering: [{ id: "watering-1", plant: "plant-3", amount: 2 }],
    nonsense: [{ x: 1 }],
  };

  it("keeps the rows that fit, drops the ones that do not — and what the model cannot know (a photo)", () => {
    expect(sampleSeed(reply, plants())).toEqual({
      plant: [
        { id: "plant-1", name: "Monstera by the window", light: "shade" },
        { id: "plant-2", name: "Lemon tree", light: "sun" },
      ],
      // Its plant was not a record that fits: the reference goes, the watering stays.
      watering: [{ id: "watering-1", amount: 2 }],
    });
  });

  it("is none when fewer than two rows fit: the app opens on an empty copy", () => {
    // One of the two fits: not enough to show what the app is for.
    expect(sampleSeed({ plant: [{ id: "plant-1", name: "Basil", light: "full sun" }, { id: "plant-2", name: "Fig" }] }, plants())).toBeUndefined();
    expect(sampleSeed({ plant: [{ name: "Fig" }, { name: "Olive" }] }, plants())).toEqual({ plant: [{ name: "Fig" }, { name: "Olive" }] });
  });

  it("is none for a reply that is not rows", () => {
    for (const bad of [null, "Monstera", [{ name: "Fig" }], { plant: "Fig" }, { plant: [1, 2, "x"] }]) expect(sampleSeed(bad, plants())).toBeUndefined();
    expect(sampleSeed(reply, undefined)).toBeUndefined();
  });
});

describe("a saved app's seed", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("is kept through every later version, whatever their shape: nothing narrows it where it is kept", async () => {
    await saveUserApp({ id: "watering", name: "Watering", source: "s1", seed }, NOW);
    await saveUserApp({ id: "watering", name: "Watering", source: "s2" }, NOW);
    expect(getUserApp("watering")?.seed).toEqual(seed);
  });

  it("comes back whole when History puts back a version its rows fit, after one they did not", async () => {
    await saveUserApp({ id: "watering", name: "Watering", source: "v1", seed }, NOW);
    // v2 took "sun" away: a link made now carries the shade plant only…
    await saveUserApp({ id: "watering", name: "Watering", source: "v2" }, NOW);
    const v2 = plants({ light: { type: "enum", options: ["shade"] } });
    expect(seedThatFits(getUserApp("watering")!.seed, v2)?.plant).toEqual([seed.plant![0]]);
    // …and going back to v1 gets the lemon tree back, because the kept seed was never cut.
    const v1 = (await listVersions("watering")).find((v) => v.source === "v1")!;
    await restoreVersion(getUserApp("watering")!, v1, "went back to version 1", NOW);
    expect(getUserApp("watering")?.source).toBe("v1");
    expect(getUserApp("watering")?.seed).toEqual(seed);
    expect(seedThatFits(getUserApp("watering")!.seed, plants())).toEqual(seed);
  });

  it("is kept only when it is small, whichever way it came: the Studio's too (MAX_KEPT_SEED)", async () => {
    const big: AppSeed = { plant: Array.from({ length: 2_000 }, (_, i) => ({ id: `p${i}`, name: `A plant with a long name, number ${i}` })) };
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_KEPT_SEED);
    await saveUserApp({ id: "watering", name: "Watering", source: "s1", seed: big }, NOW);
    expect(getUserApp("watering")?.seed).toBeUndefined();
    await saveUserApp({ id: "watering", name: "Watering", source: "s2", seed }, NOW);
    expect(getUserApp("watering")?.seed).toEqual(seed);
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

  it("a package saved from a version fits it to that version: only the rows it takes", async () => {
    const store = new MemoryStore();
    await store.open("user:watering");
    const zip = await shippedPackage(store, { source: "export default 1", lock: undefined, seed, entities: plants({ light: { type: "enum", options: ["shade"] } }) });
    expect(readAppPackage(zip).seed).toEqual({ plant: [seed.plant![0]], watering: [seed.watering![0], { id: "w2", amount: 1 }] });
  });
});
