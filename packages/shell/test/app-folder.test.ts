// An app's folder as the shell's Files surfaces handle it (#254): what they list, how a file the
// person brings in is named, and what replacing, renaming and removing do — over a real store.
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore, fileSpace, readAppPackage, type Store } from "@potyro/store";
import { bringIn, earlierCopies, filesHere, freePath, largeForSharing, listFolder, readFile, readForView, removeFile, renameFile, replaceFile, restoreCopy, shippedPackage, viewKind, watchArrival } from "../src/app-folder.js";

const file = (name: string, text: string, type = "text/plain"): File => new File([text], name, { type });

let store: Store;
beforeEach(async () => {
  store = new MemoryStore();
  await store.open("notes");
});

describe("freePath", () => {
  it("keeps a name nobody has, and numbers one that is taken, before its extension", () => {
    expect(freePath(new Set(), "notes.md")).toBe("notes.md");
    expect(freePath(new Set(["notes.md"]), "notes.md")).toBe("notes 2.md");
    expect(freePath(new Set(["notes.md", "notes 2.md"]), "notes.md")).toBe("notes 3.md");
    expect(freePath(new Set(["README"]), "README")).toBe("README 2");
    expect(freePath(new Set(["a/b.tar.gz"]), "a/b.tar.gz")).toBe("a/b 2.tar.gz");
  });
});

describe("the folder", () => {
  it("lists the person's files and never the app's code", async () => {
    const space = fileSpace(store);
    await space.write("plan.json", new Blob(["{}"]), { origin: "shipped" });
    await space.write(".modules/abc.js", new Blob(["x"]), { origin: "shipped" });
    await space.write(".src/plan.ts", new Blob(["y"]), { origin: "shipped" });
    expect((await listFolder(store)).map((f) => f.path)).toEqual(["plan.json"]);
  });

  it("brings files in as the person's, beside — never over — one with the same name", async () => {
    await fileSpace(store).write("notes.md", new Blob(["# mine"]), { origin: "app" });
    const landed = await bringIn(store, [file("notes.md", "# theirs"), file("todo.txt", "milk")]);
    expect(landed.map((f) => [f.path, f.origin])).toEqual([
      ["notes 2.md", "imported"],
      ["todo.txt", "imported"],
    ]);
    expect(await (await fileSpace(store).read("notes.md"))!.text()).toBe("# mine");
    expect(await (await fileSpace(store).read("notes 2.md"))!.text()).toBe("# theirs");
  });

  it("brings files in as what the app ships with, from the Studio", async () => {
    const [f] = await bringIn(store, [file("plan.json", "{}", "application/json")], { origin: "shipped" });
    expect(f!.origin).toBe("shipped");
    expect(f!.mime).toBe("application/json");
  });

  it("refuses a name kept for the app's code", async () => {
    await expect(bringIn(store, [file("x.js", "1")], { folder: ".modules" })).rejects.toThrow();
  });

  it("replaces a file's bytes under its own name and id, keeping where it came from unless told", async () => {
    const [f] = await bringIn(store, [file("plan.json", "{}")], { origin: "shipped" });
    const replaced = await replaceFile(store, f!.id, file("other-name.json", '{"a":1}'), { origin: "shipped" });
    expect(replaced).toMatchObject({ id: f!.id, path: "plan.json", origin: "shipped", size: 7 });
    const mine = await replaceFile(store, f!.id, file("x.json", "[]"));
    expect(mine.origin).toBe("imported");
  });

  it("renames within the folder, and says so plainly when the name is taken", async () => {
    const [a] = await bringIn(store, [file("a.md", "a"), file("b.md", "b")]);
    await expect(renameFile(store, a!.id, "b.md")).rejects.toThrow(/already a file called b\.md/);
    const moved = await renameFile(store, a!.id, "  notes/a.md ");
    expect(moved.path).toBe("notes/a.md");
    await expect(renameFile(store, a!.id, ".src/a.md")).rejects.toThrow();
    await expect(renameFile(store, a!.id, "   ")).rejects.toThrow();
  });

  it("removes a file, bytes and all", async () => {
    const [a] = await bringIn(store, [file("a.md", "a")]);
    await removeFile(store, a!.id);
    expect(await listFolder(store)).toEqual([]);
  });
});

describe("viewing a file", () => {
  it("knows what it can show", () => {
    expect(viewKind({ name: "a.md", mime: "text/markdown" })).toBe("text");
    expect(viewKind({ name: "a.json", mime: "application/json" })).toBe("text");
    expect(viewKind({ name: "a.csv", mime: "text/csv" })).toBe("text");
    expect(viewKind({ name: "a.png", mime: "image/png" })).toBe("image");
    expect(viewKind({ name: "a.mp3", mime: "audio/mpeg" })).toBe("audio");
    expect(viewKind({ name: "a.zip", mime: "application/zip" })).toBe("none");
  });

  it("reads text, cut short past a limit", async () => {
    const [a] = await bringIn(store, [file("a.txt", "x".repeat(50))]);
    expect(await readForView(store, a!.id, { limit: 10 })).toEqual({ kind: "text", text: "x".repeat(10), cut: true });
    expect(await readForView(store, a!.id)).toEqual({ kind: "text", text: "x".repeat(50), cut: false });
  });

  it("says when the bytes are not on this device", async () => {
    const [a] = await bringIn(store, [file("a.txt", "x")]);
    const entry = await fileSpace(store).find(a!.id ? { id: a!.id } : "a.txt");
    await store.deleteBlob(entry!.blob);
    expect(await readForView(store, a!.id)).toEqual({ kind: "missing" });
  });
});

describe("a shared app's files (#255)", () => {
  it("says which files are on this device, asking the store and never reading them", async () => {
    const [a] = await bringIn(store, [file("a.txt", "x")]);
    const asked: string[] = [];
    const shared = Object.assign(Object.create(store) as Store, {
      blobHere: async (r: { key: string }) => (asked.push(r.key), false),
      getBlob: async () => {
        throw new Error("a list must not fetch");
      },
    });
    expect(await filesHere(shared, [a!])).toEqual(new Map([[a!.id, false]]));
    expect(asked).toHaveLength(1);
    expect(await filesHere(store, [a!])).toEqual(new Map([[a!.id, true]]));
  });

  it("tells when a file's bytes arrive", async () => {
    const [a] = await bringIn(store, [file("a.txt", "x")]);
    let fire: (() => void) | null = null;
    const shared = Object.assign(Object.create(store) as Store, { subscribeBlob: (_r: unknown, cb: () => void) => ((fire = cb), () => (fire = null)) });
    let arrived = 0;
    const stop = await watchArrival(shared, a!.id, () => arrived++);
    fire!();
    expect(arrived).toBe(1);
    stop();
    expect(fire).toBeNull();
  });

  it("lists earlier copies and brings one back", async () => {
    const [a] = await bringIn(store, [file("a.txt", "one")]);
    await replaceFile(store, a!.id, file("a.txt", "two"));
    const [one] = await earlierCopies(store, a!.id);
    expect(one!.size).toBe(3);
    await restoreCopy(store, a!.id, one!);
    expect(await (await readFile(store, a!.id))!.text()).toBe("one");
  });

  it("asks before a large file goes into a shared app, and only then", () => {
    const big = { name: "film.mov", size: 80 * 1024 * 1024 } as File;
    const small = { name: "a.md", size: 10 } as File;
    expect(largeForSharing([small, big], true)).toEqual([big]);
    expect(largeForSharing([small, big], false)).toEqual([]);
  });
});

describe("the package the Studio saves", () => {
  it("is the source and what ships with it — not what the person added or the app made", async () => {
    await bringIn(store, [file("plan.json", '{"weeks":3}')], { origin: "shipped" });
    await bringIn(store, [file("mine.md", "# mine")]);
    await fileSpace(store).write("state.json", new Blob(["{}"]), { origin: "app" });
    const zip = await shippedPackage(store, { source: "export default 1", lock: undefined });
    const pkg = readAppPackage(zip);
    expect(pkg.source).toBe("export default 1");
    expect(pkg.files.map((f) => f.path)).toEqual(["plan.json"]);
    expect(new TextDecoder().decode(pkg.files[0]!.data)).toBe('{"weeks":3}');
  });
});
