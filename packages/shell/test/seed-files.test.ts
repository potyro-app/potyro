// Photos in sample records (seed-files.ts): a seed names a picture by the file the app ships with, and
// the device that writes the record gives it its own copy. Covers both ways sample records are written:
// a package's seed (a demo link, a seed.json) and an example's first run.
import { describe, expect, it } from "vitest";
import { fileSpace, MemoryStore, type Store } from "@potyro/store";
import type { MediaRef } from "potyro";
import { applySeed, fileFieldsOf } from "../src/add-app.js";
import { demoSeed } from "../src/demo-package.js";
import { seedIfEmpty } from "../src/seed.js";
import { exampleFilePaths } from "../src/example-files.js";

const PIXEL = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

async function storeWith(files: Record<string, Uint8Array>): Promise<Store> {
  const store = new MemoryStore();
  await store.open(`test:${Math.random()}`);
  for (const [path, bytes] of Object.entries(files)) {
    await fileSpace(store).write(path, new Blob([bytes as BlobPart], { type: "image/webp" }), { origin: "shipped", mime: "image/webp" });
  }
  return store;
}

async function bytesOf(store: Store, ref: MediaRef): Promise<Uint8Array> {
  const blob = await store.getBlob(ref);
  return new Uint8Array(await blob!.arrayBuffer());
}

describe("a seed's photos", () => {
  it("become the record's own copy of the shipped file — alone, or in a list", async () => {
    const store = await storeWith({ "photos/a.webp": PIXEL });
    await applySeed(store, { place: [{ name: "One", photo: { file: "photos/a.webp" }, more: [{ file: "photos/a.webp" }] }] }, ["place"]);
    const [row] = (await store.all("place")) as unknown as Array<{ photo: MediaRef; more: MediaRef[] }>;
    expect(row!.photo.key).toEqual(expect.any(String));
    expect(await bytesOf(store, row!.photo)).toEqual(PIXEL);
    expect(row!.more).toHaveLength(1);
    expect(await bytesOf(store, row!.more[0]!)).toEqual(PIXEL);
    // A copy, not the file: replacing the file leaves the record's photo as it was.
    await fileSpace(store).write("photos/a.webp", new Blob([new Uint8Array([9, 9])]), { origin: "imported" });
    expect(await bytesOf(store, row!.photo)).toEqual(PIXEL);
  });

  it("are left out when the file is not there, and the record still arrives", async () => {
    const store = await storeWith({});
    expect(await applySeed(store, { place: [{ name: "Two", photo: { file: "photos/missing.webp" }, more: [{ file: "photos/missing.webp" }] }] }, ["place"])).toBe(1);
    const [row] = (await store.all("place")) as unknown as Array<Record<string, unknown>>;
    expect(row!.name).toBe("Two");
    expect(row!.photo).toBeUndefined();
    expect(row!.more).toEqual([]);
  });

  it("leave every other value alone, objects included", async () => {
    const store = await storeWith({});
    await applySeed(store, { place: [{ name: "Three", location: { lat: 1, lng: 2 }, notes: "file" }] }, ["place"]);
    const [row] = (await store.all("place")) as unknown as Array<Record<string, unknown>>;
    expect(row!.location).toEqual({ lat: 1, lng: 2 });
  });
});

describe("a seed's documents (#389)", () => {
  it("on a `file` field, point at the shipped file itself — its id, path, name and mime — so the app reads it as its own", async () => {
    const store = await storeWith({ "notes/welcome.md": new TextEncoder().encode("# Welcome\n") });
    await applySeed(store, { note: [{ title: "Welcome", doc: { file: "notes/welcome.md" } }] }, ["note"], { note: ["doc"] });
    const [row] = (await store.all("note")) as unknown as Array<{ doc: { id: string; path: string; name: string; mime?: string } }>;
    const info = await fileSpace(store).find("notes/welcome.md");
    expect(row!.doc).toEqual({ id: info!.id, path: "notes/welcome.md", name: "welcome.md", mime: info!.mime });
    // The file, not a copy: what the folder holds is what the note reads.
    expect(await (await fileSpace(store).read({ id: row!.doc.id }))!.text()).toBe("# Welcome\n");
  });

  it("are left out when the file is not there; a photo field keeps being a copy", async () => {
    const store = await storeWith({ "photos/a.webp": PIXEL });
    await applySeed(store, { note: [{ title: "Gone", doc: { file: "notes/gone.md" }, cover: { file: "photos/a.webp" } }] }, ["note"], { note: ["doc"] });
    const [row] = (await store.all("note")) as unknown as Array<{ doc?: unknown; cover: MediaRef }>;
    expect(row!.doc).toBeUndefined();
    expect(row!.cover.key).toEqual(expect.any(String));
  });

  it("knows an app's `file` fields from its definition", () => {
    expect(fileFieldsOf({ note: { fields: { title: { type: "text" }, doc: { type: "file" } } }, tag: { fields: { name: { type: "text" } } } })).toEqual({ note: ["doc"] });
    expect(fileFieldsOf(undefined)).toEqual({});
  });
});

describe("an example's sample records", () => {
  it("ship a photo for every recipe, plant and place they name", () => {
    for (const id of ["recipes", "plants", "places"]) expect(exampleFilePaths(id).filter((p) => p.startsWith("photos/")).length).toBeGreaterThanOrEqual(10);
  });

  it("carry their photos as paths in a demo link, never as this device's keys", async () => {
    const seed = await demoSeed("recipes", ["recipe", "ingredient"]);
    const recipes = seed!.recipe!;
    expect(recipes.length).toBeGreaterThanOrEqual(12);
    const paths = new Set(exampleFilePaths("recipes"));
    for (const r of recipes) {
      expect(r.photo).toEqual({ file: expect.stringMatching(/^photos\//) });
      expect(paths.has((r.photo as { file: string }).file)).toBe(true);
    }
  });

  it("take their photos from the app's folder on a first run", async () => {
    const store = await storeWith({ "photos/fern.webp": PIXEL });
    await seedIfEmpty(store, "plants");
    const plants = (await store.all("plant")) as unknown as Array<{ name: string; photo?: MediaRef }>;
    const fern = plants.find((p) => p.name === "Fern")!;
    expect(await bytesOf(store, fern.photo!)).toEqual(PIXEL);
    // A plant whose file is not in the folder arrives without a photo.
    expect(plants.find((p) => p.name === "Monstera")!.photo).toBeUndefined();
  });
});
