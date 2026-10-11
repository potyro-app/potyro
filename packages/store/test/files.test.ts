// The app's own folder (#252), against every Store.
//
// One battery, four stores, the same assertions: a folder that behaved differently on the shared
// store than on the local one would break exactly the app that was shared. Then the things only
// some stores have — persistence across a reload, a copy between stores, two peers.
import { beforeAll, describe, expect, it } from "vitest";
import { LocalNode } from "cojson";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import {
  copyStoreData,
  createMemorySqliteStore,
  createPeerPair,
  fileSpace,
  FileSpaceError,
  JazzStore,
  LocalStore,
  MemoryStore,
  normalisePath,
  type StorageLike,
  type Store,
} from "../src/index.js";

let crypto: Awaited<ReturnType<typeof WasmCrypto.create>>;
beforeAll(async () => {
  crypto = await WasmCrypto.create();
});

function fakeBackend(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

async function jazz(): Promise<Store> {
  const { node } = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "test" }, crypto });
  const s = new JazzStore({ node: node as never, group: node.createGroup() as never });
  await s.open("files");
  return s;
}

const STORES: Array<[string, () => Promise<Store>]> = [
  ["MemoryStore", async () => { const s = new MemoryStore(); await s.open("files"); return s; }],
  ["LocalStore", async () => { const s = new LocalStore(fakeBackend()); await s.open("files"); return s; }],
  ["SqliteStore", async () => (await createMemorySqliteStore("files")).store],
  ["JazzStore", jazz],
];

const text = (s: string, type = "") => new Blob([s], { type });

describe.each(STORES)("the folder on %s", (_name, make) => {
  it("writes a file and reads it back, with its details", async () => {
    const files = fileSpace(await make());
    const info = await files.write("notes/today.md", text("# Today"));

    expect(info).toMatchObject({ path: "notes/today.md", name: "today.md", mime: "text/markdown", size: 7, origin: "app" });
    expect(info.id).toBeTruthy();
    expect(info.hash).toMatch(/^(sha256|fnv)-/);
    expect(await (await files.read("notes/today.md"))!.text()).toBe("# Today");
    expect(await (await files.read({ id: info.id }))!.text()).toBe("# Today");
  });

  it("lists everything, or one folder and what is under it, in path order", async () => {
    const files = fileSpace(await make());
    await files.write("b.txt", text("b"));
    await files.write("notes/old/z.md", text("z"));
    await files.write("notes/a.md", text("a"));
    await files.write("notesy.md", text("not in notes"));

    expect((await files.list()).map((f) => f.path)).toEqual(["b.txt", "notes/a.md", "notes/old/z.md", "notesy.md"]);
    expect((await files.list("notes")).map((f) => f.path)).toEqual(["notes/a.md", "notes/old/z.md"]);
    expect((await files.list("/notes/")).map((f) => f.path)).toEqual(["notes/a.md", "notes/old/z.md"]);
  });

  it("replacing a file keeps its id and created time, and changes its bytes and hash", async () => {
    const files = fileSpace(await make());
    const first = await files.write("plan.json", text('{"v":1}'));
    const second = await files.write("plan.json", text('{"v":2}'));

    expect(second.id).toBe(first.id);
    expect(second.created).toBe(first.created);
    expect(second.hash).not.toBe(first.hash);
    expect(await (await files.read("plan.json"))!.text()).toBe('{"v":2}');
    expect(await files.list()).toHaveLength(1);
  });

  it("renaming keeps the id, so a reference by id still finds it; the old path is gone", async () => {
    const files = fileSpace(await make());
    const made = await files.write("draft.md", text("x"));
    const moved = await files.rename("draft.md", "notes/final.md");

    expect(moved.id).toBe(made.id);
    expect(moved.name).toBe("final.md");
    expect(await files.find("draft.md")).toBeNull();
    expect((await files.find({ id: made.id }))?.path).toBe("notes/final.md");
  });

  it("will not rename onto a path that is taken", async () => {
    const files = fileSpace(await make());
    await files.write("a.md", text("a"));
    await files.write("b.md", text("b"));
    await expect(files.rename("a.md", "b.md")).rejects.toMatchObject({ code: "taken" });
  });

  it("removes a file, after which reading it is an error naming it", async () => {
    const files = fileSpace(await make());
    await files.write("gone.txt", text("bye"));
    await files.remove("gone.txt");

    expect(await files.list()).toEqual([]);
    await expect(files.read("gone.txt")).rejects.toThrow(/gone\.txt/);
    await expect(files.read("gone.txt")).rejects.toBeInstanceOf(FileSpaceError);
  });

  it("a shipped file becomes the app's once written to; an imported one stays imported", async () => {
    const files = fileSpace(await make());
    await files.write("plan.json", text("{}"), { origin: "shipped" });
    await files.write("in.md", text("x"), { origin: "imported" });

    expect((await files.write("plan.json", text('{"mine":true}'))).origin).toBe("app");
    expect((await files.write("in.md", text("y"))).origin).toBe("imported");
  });

  it("takes the type it is given, else the blob's, else the extension's", async () => {
    const files = fileSpace(await make());
    expect((await files.write("a.bin", text("x"), { mime: "text/plain" })).mime).toBe("text/plain");
    expect((await files.write("b.data", text("x", "image/png"))).mime).toBe("image/png");
    expect((await files.write("c.csv", text("x"))).mime).toBe("text/csv");
    expect((await files.write("d", text("x"))).mime).toBe("application/octet-stream");
  });

  it("keeps binary bytes exactly", async () => {
    const files = fileSpace(await make());
    const bytes = new Uint8Array(256).map((_, i) => i);
    await files.write("all.bin", new Blob([bytes]));
    expect(new Uint8Array(await (await files.read("all.bin"))!.arrayBuffer())).toEqual(bytes);
  });

  it("tells subscribers when the folder changes", async () => {
    const store = await make();
    let calls = 0;
    const stop = store.subscribeFiles?.(() => calls++);
    await fileSpace(store).write("x.txt", text("x"));
    await new Promise((r) => setTimeout(r, 20));
    stop?.();
    expect(calls).toBeGreaterThan(0);
  });
});

describe("paths", () => {
  it("normalises slashes, a leading ./ or /, and Windows separators", () => {
    expect(normalisePath(" /notes//a.md ")).toBe("notes/a.md");
    expect(normalisePath("./notes/a.md")).toBe("notes/a.md");
    expect(normalisePath("notes\\a.md")).toBe("notes/a.md");
  });

  it("refuses an empty path, a folder, and climbing out with ..", () => {
    for (const bad of ["", "   ", "notes/", "../secret", "a/../b", "a/./b"]) {
      expect(() => normalisePath(bad)).toThrow(FileSpaceError);
    }
  });
});

describe("the folder survives", () => {
  it("a reload of the localStorage store", async () => {
    const backend = fakeBackend();
    const a = new LocalStore(backend);
    await a.open("files");
    const made = await fileSpace(a).write("keep.md", text("still here"));

    const b = new LocalStore(backend);
    await b.open("files");
    expect(await (await fileSpace(b).read({ id: made.id }))!.text()).toBe("still here");
  });

  it("a copy to another store — the way sync is switched on and an app is exported", async () => {
    const from = new MemoryStore();
    await from.open("files");
    const made = await fileSpace(from).write("notes/a.md", text("copied"));
    const to = (await createMemorySqliteStore("files")).store;

    const result = await copyStoreData(from, to, { entities: [] });

    expect(result).toMatchObject({ files: 1, skippedFiles: [] });
    const copied = await fileSpace(to).find({ id: made.id });
    expect(copied?.path).toBe("notes/a.md");
    expect(await (await fileSpace(to).read({ id: made.id }))!.text()).toBe("copied");
  });
});

describe("the folder between two members of a shared app", () => {
  it("a file one member writes is listed and readable on the other", async () => {
    const pair = await createPeerPair("files-pair");
    try {
      const made = await fileSpace(pair.a).write("notes/shared.md", text("from Ana"));
      let got: string | null = null;
      for (let i = 0; i < 40 && got == null; i++) {
        await pair.settle(50);
        const f = await fileSpace(pair.b).find({ id: made.id });
        const blob = f ? await fileSpace(pair.b).read({ id: made.id }) : null;
        got = blob ? await blob.text() : null;
      }
      expect(got).toBe("from Ana");
      expect((await fileSpace(pair.b).list()).map((f) => f.path)).toEqual(["notes/shared.md"]);
    } finally {
      await pair.close();
    }
  });
});
