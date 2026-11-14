// Storage the browser will not open, set aside and put back: the rules of `setAside` and `putBack`
// over a directory and a stash that behave like OPFS and IndexedDB. What Firefox itself does in that
// state was measured by hand against a copy of a stuck profile (see storage-rescue.ts).

import { describe, expect, it } from "vitest";
import { isStorageStuck, looksStuck, putBack, setAside, StorageStuckError, type RescueDir, type RescueStash } from "../src/storage-rescue.js";

const bytes = (...n: number[]): ArrayBuffer => new Uint8Array(n).buffer;
const list = (b: ArrayBuffer | undefined): number[] => [...new Uint8Array(b ?? new ArrayBuffer(0))];

function fakeDir(files: Record<string, ArrayBuffer>, opts: { stuck?: boolean } = {}): RescueDir & { files: Map<string, ArrayBuffer>; opts: { stuck?: boolean } } {
  const held = new Map(Object.entries(files));
  return {
    files: held,
    opts,
    names: async () => [...held.keys()],
    read: async (name) => held.get(name)!.slice(0),
    async write(name, data) {
      if (opts.stuck) throw Object.assign(new Error("Unknown failure"), { name: "UnknownError" });
      held.set(name, data.slice(0));
    },
    async remove(name) {
      held.delete(name);
    },
  };
}

function fakeStash(opts: { corrupt?: boolean; failAt?: number } = {}): RescueStash & { held: Map<string, ArrayBuffer> } {
  const held = new Map<string, ArrayBuffer>();
  let puts = 0;
  return {
    held,
    async put(key, data) {
      if (opts.failAt !== undefined && ++puts > opts.failAt) throw new Error("the quota has been exceeded");
      held.set(key, opts.corrupt ? data.slice(1) : data.slice(0));
    },
    get: async (key) => held.get(key)?.slice(0),
    keys: async () => [...held.keys()],
    async clear() {
      held.clear();
    },
  };
}

describe("storage the browser will not open", () => {
  it("is set aside whole, and only then removed", async () => {
    const potyro = fakeDir({ a: bytes(1, 2, 3), b: bytes(4) });
    const karta = fakeDir({ c: bytes(5, 6) });
    const stash = fakeStash();
    await setAside({ "/potyro": potyro, "/karta": karta }, stash);
    expect(potyro.files.size).toBe(0);
    expect(karta.files.size).toBe(0);
    expect(list(stash.held.get("/potyro/a"))).toEqual([1, 2, 3]);
    expect(list(stash.held.get("/karta/c"))).toEqual([5, 6]);
  });

  it("removes nothing when a file did not come back from the stash as it went in", async () => {
    const dir = fakeDir({ a: bytes(1, 2, 3) });
    await expect(setAside({ "/potyro": dir }, fakeStash({ corrupt: true }))).rejects.toThrow();
    expect(list(dir.files.get("a"))).toEqual([1, 2, 3]);
  });

  it("removes nothing when the stash ran out of room part-way", async () => {
    const dir = fakeDir({ a: bytes(1), b: bytes(2), c: bytes(3) });
    const stash = fakeStash({ failAt: 2 });
    await expect(setAside({ "/potyro": dir }, stash)).rejects.toThrow();
    expect(dir.files.size).toBe(3);
    // and the half-made stash is never put back over the real files
    stash.held.set("/potyro/a", bytes(9, 9));
    expect(await putBack(async () => dir, stash)).toBe(false);
    expect(list(dir.files.get("a"))).toEqual([1]);
    expect(stash.held.size).toBe(0);
  });

  it("is put back where it was, and the stash emptied", async () => {
    const before = fakeDir({ a: bytes(1, 2, 3), b: bytes(4) });
    const stash = fakeStash();
    await setAside({ "/potyro": before }, stash);
    const after = new Map<string, ReturnType<typeof fakeDir>>();
    const put = await putBack(async (directory) => {
      const dir = after.get(directory) ?? fakeDir({});
      after.set(directory, dir);
      return dir;
    }, stash);
    expect(put).toBe(true);
    expect(list(after.get("/potyro")?.files.get("a"))).toEqual([1, 2, 3]);
    expect(list(after.get("/potyro")?.files.get("b"))).toEqual([4]);
    expect(stash.held.size).toBe(0);
  });

  it("stays in the stash while the browser still will not write, and goes back once it does", async () => {
    // The same browser session: writing fails everywhere until the browser is restarted.
    const dir = fakeDir({ a: bytes(1, 2, 3) });
    const stash = fakeStash();
    await setAside({ "/potyro": dir }, stash);
    dir.opts.stuck = true;
    await expect(putBack(async () => dir, stash)).rejects.toSatisfy(looksStuck);
    expect(list(stash.held.get("/potyro/a"))).toEqual([1, 2, 3]);
    dir.opts.stuck = false;
    expect(await putBack(async () => dir, stash)).toBe(true);
    expect(list(dir.files.get("a"))).toEqual([1, 2, 3]);
  });

  it("has nothing to put back where nothing was set aside", async () => {
    expect(await putBack(async () => fakeDir({}), fakeStash())).toBe(false);
  });

  it("knows the browser's words for it, and its own error", () => {
    expect(looksStuck(Object.assign(new Error("Unknown failure"), { name: "UnknownError" }))).toBe(true);
    expect(looksStuck(Object.assign(new Error("No modification allowed"), { name: "NoModificationAllowedError" }))).toBe(false);
    expect(looksStuck(new Error("anything else"))).toBe(false);
    expect(isStorageStuck(new StorageStuckError())).toBe(true);
    expect(isStorageStuck({ code: "storage-stuck" })).toBe(true);
    expect(isStorageStuck(new Error("no"))).toBe(false);
  });
});
