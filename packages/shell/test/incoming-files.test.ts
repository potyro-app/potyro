// @vitest-environment happy-dom
//
// Files that arrive from outside — dropped on Potyro, shared to it, opened with it (#254): which are
// an app to add, which are files for an app, which app suits them, and where they land.
import { describe, expect, it } from "vitest";
import { MemoryStore, fileSpace, packAppPackage } from "@potyro/store";
import { arrivedIn, fitsFor, isAppArrival, landFiles, offerFiles, onOffer, takeOffer } from "../src/incoming-files.js";

const file = (name: string, body: string | Uint8Array, type = ""): File => new File([body as BlobPart], name, { type });
const APP = `import { defineApp } from "potyro";\nexport default defineApp({ id: "notes", name: "Notes", version: "1.0.0", schemaVersion: 1, entities: {}, pages: [] });`;

describe("is it an app?", () => {
  it("a package zip, an .app.ts, or one script that defines an app", async () => {
    expect(await isAppArrival([file("notes.potyro-app.zip", packAppPackage({ source: APP, sourceName: "app.ts", files: [], seed: undefined, chat: undefined }))])).toBe(true);
    expect(await isAppArrival([file("notes.app.tsx", "whatever")])).toBe(true);
    expect(await isAppArrival([file("main.ts", APP)])).toBe(true);
    expect(await isAppArrival([file("main.app.ts", APP), file("plan.json", "{}")])).toBe(true);
  });

  it("anything else is files for an app — a zip of photos too", async () => {
    // An empty zip: the end-of-directory record and nothing else.
    const emptyZip = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
    expect(await isAppArrival([file("photos.zip", emptyZip)])).toBe(false);
    expect(await isAppArrival([file("notes.md", "# hi")])).toBe(false);
    expect(await isAppArrival([file("helper.ts", "export const x = 1")])).toBe(false);
    expect(await isAppArrival([file("a.md", "a"), file("b.md", "b")])).toBe(false);
  });
});

describe("which app suits them", () => {
  const notes = { id: "notes", name: "Notes", source: `defineApp({ id: "notes", entities: { note: { fields: { doc: { type: "file", accept: ".md,.txt" } } } } })` };
  const photos = { id: "photos", name: "Photos", source: `defineApp({ id: "photos", entities: { shot: { fields: { pic: { type: "file", accept: "image/*" } } } } })` };
  const plain = { id: "groceries", name: "Groceries", source: `defineApp({ id: "groceries", entities: { item: { fields: { name: { type: "text" } } } } })` };

  it("an app with a file field that takes them, first", async () => {
    expect(await fitsFor([file("a.md", "x", "text/markdown")], [plain, photos, notes])).toEqual(["notes"]);
    expect(await fitsFor([file("a.png", "x", "image/png")], [plain, photos, notes])).toEqual(["photos"]);
    expect(await fitsFor([file("a.pdf", "x", "application/pdf")], [plain, photos, notes])).toEqual([]);
  });
});

describe("landing them", () => {
  it("puts them in the app's folder as the person's, and remembers which to point out", async () => {
    const store = new MemoryStore();
    await store.open("notes");
    await fileSpace(store).write("a.md", new Blob(["mine"]), { origin: "app" });
    const landed = await landFiles(store, "notes", [file("a.md", "theirs"), file("b.md", "b")], () => 1_000);
    expect(landed.map((f) => [f.path, f.origin])).toEqual([
      ["a 2.md", "imported"],
      ["b.md", "imported"],
    ]);
    expect(arrivedIn("notes", () => 5_000)).toEqual(landed.map((f) => f.id));
    expect(arrivedIn("notes", () => 60_000)).toEqual([]);
    expect(arrivedIn("groceries", () => 5_000)).toEqual([]);
  });
});

describe("the offer", () => {
  it("is kept until taken, and told to whoever listens", () => {
    const seen: number[] = [];
    const stop = onOffer((files) => seen.push(files.length));
    offerFiles([file("a.md", "a")]);
    expect(seen).toEqual([1]);
    expect(takeOffer()?.length).toBe(1);
    expect(takeOffer()).toBeNull();
    stop();
    offerFiles([file("b.md", "b")]);
    expect(seen).toEqual([1]);
    takeOffer();
  });
});
