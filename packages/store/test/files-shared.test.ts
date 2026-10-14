// A shared app's folder (#255): the LIST is everyone's, the BYTES travel when someone reads them.
//
// Through a relay, as real devices are connected: two peers wired directly push everything to each
// other and would make "on demand" impossible to see (peer-harness.ts says why).
import { afterEach, describe, expect, it } from "vitest";
import { copyStoreData, createRelayedPair, fileSpace, MemoryStore, type PeerPair } from "../src/index.js";

const text = (s: string): Blob => new Blob([s], { type: "text/plain" });

/** Poll until `probe` answers something other than undefined/null/false, or give up. */
async function eventually<T>(pair: PeerPair, probe: () => Promise<T>, tries = 60): Promise<T> {
  let got = await probe();
  for (let i = 0; i < tries && (got === undefined || got === null || got === false); i++) {
    await pair.settle(50);
    got = await probe();
  }
  return got;
}

let pair: PeerPair | null = null;
afterEach(async () => {
  await pair?.close();
  pair = null;
});

describe("a shared app's files, on demand", () => {
  it("the list reaches the other member at once; the bytes only when they read it", async () => {
    pair = await createRelayedPair("on-demand");
    const made = await fileSpace(pair.a).write("notes/plan.md", text("# Plan"));
    expect(await fileSpace(pair.a).here({ id: made.id })).toBe(true);

    const listed = await eventually(pair, async () => (await fileSpace(pair!.b).list()).find((f) => f.id === made.id) ?? null);
    expect(listed).toMatchObject({ path: "notes/plan.md", size: 6, origin: "app" });
    // Listed for a while and still not here: nothing pushed it.
    await pair.settle(400);
    expect(await fileSpace(pair.b).here({ id: made.id })).toBe(false);

    // Reading asks for it; once arrived it reads, and stays here.
    const bytes = await eventually(pair, () => fileSpace(pair!.b).read({ id: made.id }));
    expect(await bytes!.text()).toBe("# Plan");
    expect(await fileSpace(pair.b).here({ id: made.id })).toBe(true);
  });

  it("a file still arrives when the member who added it has gone offline: the relay holds it", async () => {
    pair = await createRelayedPair("adder-offline");
    const made = await fileSpace(pair.a).write("photo.bin", new Blob([new Uint8Array(150_000).fill(7)]));
    await pair.settle(600);
    pair.disconnectA!();
    const bytes = await eventually(pair, () => fileSpace(pair!.b).read({ id: made.id }));
    expect(bytes?.size).toBe(150_000);
  });

  it("someone else's newer copy wins, and the one it replaced is kept as an earlier copy", async () => {
    pair = await createRelayedPair("lww");
    const first = await fileSpace(pair.a).write("list.md", text("milk"));
    await eventually(pair, () => fileSpace(pair!.b).find({ id: first.id }));
    const second = await fileSpace(pair.b).write("list.md", text("milk, eggs"));
    expect(second.id).toBe(first.id);

    const seen = await eventually(pair, async () => {
      const f = await fileSpace(pair!.a).find({ id: first.id });
      return f?.hash === second.hash ? f : null;
    });
    expect(seen?.size).toBe(10);
    const earlier = await fileSpace(pair.a).earlier({ id: first.id });
    expect(earlier.map((e) => e.size)).toEqual([4]);
    const back = await eventually(pair, () => fileSpace(pair!.a).readEarlier({ id: first.id }, earlier[0]!));
    expect(await back!.text()).toBe("milk");
  });

  it("two members who made the same path apart see one file, the newer; the other is its earlier copy", async () => {
    // Made apart: each folder gets its own entry at the same path before either sees the other's.
    const a = new MemoryStore();
    await a.open("x");
    const older = await fileSpace(a, { now: () => new Date("2026-10-01T10:00:00Z") }).write("todo.md", text("from A"));
    const newer = await fileSpace(a, { now: () => new Date("2026-10-01T10:05:00Z") }).write("tmp.md", text("from B"));
    // Then they meet: B's entry arrives under the same path (as a merge of two folders would leave it).
    await a.setFile({ ...(await a.getFile(newer.id))!, path: "todo.md", name: "todo.md" });

    const space = fileSpace(a);
    expect((await space.list()).map((f) => [f.path, f.id])).toEqual([["todo.md", newer.id]]);
    expect(await (await space.read("todo.md"))!.text()).toBe("from B");
    expect((await space.earlier("todo.md")).map((e) => e.hash)).toEqual([older.hash]);
    // The next write folds the stray entry in for good.
    await space.write("todo.md", text("together"));
    expect((await a.listFiles()).filter((f) => f.path === "todo.md")).toHaveLength(1);
  });

  it("a deleted file goes for everyone", async () => {
    pair = await createRelayedPair("delete");
    const made = await fileSpace(pair.a).write("gone.md", text("bye"));
    await eventually(pair, () => fileSpace(pair!.b).find({ id: made.id }));
    await fileSpace(pair.b).remove({ id: made.id });
    const gone = await eventually(pair, async () => ((await fileSpace(pair!.a).find({ id: made.id })) === null ? true : null));
    expect(gone).toBe(true);
  });

  it("a copy (an export) takes the files that are here, lists the rest, and fetches nothing", async () => {
    pair = await createRelayedPair("export");
    const fetched = await fileSpace(pair.a).write("read.md", text("read here"));
    const notYet = await fileSpace(pair.a).write("big.bin", new Blob([new Uint8Array(70_000)]));
    await eventually(pair, () => fileSpace(pair!.b).find({ id: notYet.id }));
    await eventually(pair, () => fileSpace(pair!.b).read({ id: fetched.id }));

    const to = new MemoryStore();
    await to.open("export");
    const result = await copyStoreData(pair.b, to, { entities: [] });
    expect(result.files).toBe(1);
    expect(result.skippedFiles).toEqual([{ path: "big.bin", size: 70_000, reason: "its bytes are not on this device" }]);
    expect(await (await fileSpace(to).read("read.md"))!.text()).toBe("read here");
    await pair.settle(300);
    expect(await fileSpace(pair.b).here({ id: notYet.id })).toBe(false);
  });

  it("a shared space never holds the app's code", async () => {
    pair = await createRelayedPair("no-code");
    await expect(fileSpace(pair.a).write(".modules/abc.js", text("x"))).rejects.toThrow(/code/);
    await expect(fileSpace(pair.a).write(".src/plan.ts", text("x"))).rejects.toThrow(/code/);
  });
});

describe("earlier copies, in any folder", () => {
  it("keeps the last few, for a while, and lets the rest go", async () => {
    const store = new MemoryStore();
    await store.open("x");
    let now = new Date("2026-10-01T00:00:00Z");
    const space = fileSpace(store, { now: () => now });
    for (const [i, body] of ["one", "two", "three", "four", "five"].entries()) {
      now = new Date(Date.UTC(2026, 9, 1 + i));
      await space.write("a.md", text(body));
    }
    // Four earlier copies, three kept: the newest first.
    const kept = await space.earlier("a.md");
    expect(await Promise.all(kept.map(async (e) => (await space.readEarlier("a.md", e))!.text()))).toEqual(["four", "three", "two"]);
    // A month on, the next write lets every copy older than that go.
    now = new Date("2026-11-20T00:00:00Z");
    await space.write("a.md", text("six"));
    expect((await space.earlier("a.md")).length).toBe(1);
  });

  it("restores an earlier copy as the newest, keeping the id", async () => {
    const store = new MemoryStore();
    await store.open("x");
    const space = fileSpace(store);
    const f = await space.write("a.md", text("one"));
    await space.write("a.md", text("two"));
    const [one] = await space.earlier("a.md");
    const restored = await space.restoreEarlier("a.md", one!);
    expect(restored.id).toBe(f.id);
    expect(await (await space.read("a.md"))!.text()).toBe("one");
    expect((await space.earlier("a.md")).map((e) => e.size)).toEqual([3]);
  });

  it("are never what the app sees of a file", async () => {
    const store = new MemoryStore();
    await store.open("x");
    const space = fileSpace(store);
    await space.write("a.md", text("one"));
    await space.write("a.md", text("two"));
    expect(Object.keys((await space.list())[0]!).sort()).toEqual(["created", "hash", "id", "mime", "name", "origin", "path", "size", "updated"]);
  });
});
