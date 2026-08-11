// The hazards a single-user app cannot see, demonstrated.
//
// These are NOT bugs in the store. Per-field last-write-wins is exactly what a CoMap promises, and
// it is the right merge for two people editing different things. They are here because app code —
// written by a model, or by anyone not thinking about two devices — routinely assumes semantics the
// store never offered, and the result is silent data loss rather than an error.
//
// Found the hard way: the first app shared in a public test had two of these at once (see
// `docs/17-concurrency-hazards.md`). Every one of them is invisible at runtime — no throw, no
// warning, no divergence. That is what makes them worth pinning in a test nobody can delete without
// noticing.

import { beforeAll, describe, expect, it } from "vitest";
import { LocalNode, cojsonInternals } from "cojson";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import { JazzStore } from "../src/index.js";

let crypto: Awaited<ReturnType<typeof WasmCrypto.create>>;
beforeAll(async () => {
  crypto = await WasmCrypto.create();
});
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

async function pair() {
  const ana = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Ana" }, crypto });
  const bru = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Bruno" }, crypto });
  const group = ana.node.createGroup();
  group.addMember(await bru.node.expectCurrentAccount("b"), "writer");
  const a = new JazzStore({ node: ana.node as never, group: group as never });
  await a.open("hazards");
  const [fa, fb] = cojsonInternals.connectedPeers("b", "a", { peer1role: "server", peer2role: "server" });
  ana.node.syncManager.addPeer(fb);
  bru.node.syncManager.addPeer(fa);
  await settle();
  const bg = await bru.node.load(group.id);
  const b = new JazzStore({ node: bru.node as never, group: bg as never, rootId: a.rootId });
  await b.open("hazards");
  return { a, b };
}

describe("read-modify-write is not safe across devices", () => {
  it("two people pressing +1 at the same moment gives +1, not +2", async () => {
    // The shape every counter, tally and "mark N of M" button in a generated app has: read the
    // value that is on screen, add to it, write it back. Both sides read 0, both write 1, and one
    // person's press is gone. Nobody is told.
    //
    // A CRDT can express this correctly — a counter that merges by summing deltas — but a CoMap
    // field cannot, because it merges by taking the last write. The app has to be given a primitive
    // that does the right thing; it cannot get there with `patch`.
    const { a, b } = await pair();
    const rec = await a.insert("item", { title: "eggs", bought: 0, qty: 10 });
    await settle();

    const seenByA = await a.get("item", rec.id);
    const seenByB = await b.get("item", rec.id);
    await Promise.all([
      a.update("item", rec.id, { bought: Number(seenByA!.bought) + 1 }),
      b.update("item", rec.id, { bought: Number(seenByB!.bought) + 1 }),
    ]);
    await settle(600);

    const final = Number((await a.get("item", rec.id))!.bought);
    expect(final, "one of the two presses survived; the other vanished silently").toBe(1);
    // Both devices agree on the wrong answer, which is why nothing looks broken.
    expect(Number((await b.get("item", rec.id))!.bought)).toBe(final);
  });

  it("BUT `increment` keeps both — the same two presses give +2", async () => {
    // The fix, and the whole thesis of the remap: app code stops computing the answer and states the
    // CHANGE, and the store — which is the only party that can see both devices — adds them up.
    // Nothing about the app's shape changes; `record.bought` is still one number.
    const { a, b } = await pair();
    const rec = await a.insert("item", { title: "eggs", bought: 0, qty: 10 });
    await settle();

    await Promise.all([a.increment!("item", rec.id, "bought", 1), b.increment!("item", rec.id, "bought", 1)]);
    await settle(600);

    expect(Number((await a.get("item", rec.id))!.bought)).toBe(2);
    expect(Number((await b.get("item", rec.id))!.bought)).toBe(2);
  });

  it("counts up from a value that was written as a plain number", async () => {
    // No migration: a field that already holds an ordinary number is the base, and increments add to
    // it. Otherwise adopting the counter would silently reset every existing count to zero.
    const { a } = await pair();
    const rec = await a.insert("item", { title: "flour", bought: 7 });
    await a.increment!("item", rec.id, "bought", 2);
    expect(Number((await a.get("item", rec.id))!.bought)).toBe(9);
  });

  it("keeps the per-session bookkeeping out of the record", async () => {
    // Subtotals are an implementation detail. If they leaked, every export, every form and every
    // custom view would have to know about them.
    const { a } = await pair();
    const rec = await a.insert("item", { title: "sugar", bought: 0 });
    await a.increment!("item", rec.id, "bought", 3);
    const row = (await a.get("item", rec.id))!;
    expect(Object.keys(row).filter((k) => k.includes("\u0001"))).toEqual([]);
    expect(row.bought).toBe(3);
  });
});

describe("a whole-array field loses one person's entire edit", () => {
  // The same mistake as the counter, one shape up, and the one an app hits the moment it has tags,
  // several assignees, or a multi-relation. `[...row.tags, "x"]` is not "add x" — it is "the tags
  // are now exactly this", written over whatever the other person just decided.
  const TAGGED = { item: { tags: { type: "tags" } } } as never;

  it("without the declared shape, two people adding a tag at once keeps one tag", async () => {
    const { a, b } = await pair();
    const rec = await a.insert("item", { title: "eggs", tags: ["food"] });
    await settle();

    // Neither store was described, so both write the whole array — which is what every store here
    // did before KA-38, and what a store that never learns the schema still does.
    const seenByA = (await a.get("item", rec.id))!.tags as string[];
    const seenByB = (await b.get("item", rec.id))!.tags as string[];
    await Promise.all([
      a.update("item", rec.id, { tags: [...seenByA, "urgent"] }),
      b.update("item", rec.id, { tags: [...seenByB, "cheap"] }),
    ]);
    await settle(600);

    const final = (await a.get("item", rec.id))!.tags as string[];
    expect(final, "one whole array won; the other person's tag went with it").toHaveLength(2);
    expect(final.includes("urgent") && final.includes("cheap")).toBe(false);
  });

  it("BUT once the store knows `tags` is a set, both survive — with no change to the app", async () => {
    // The thesis. The app still reads an array, spreads it, and writes an array. What changed is
    // that the store now knows what it is holding, so it writes the DIFFERENCE — one key per element
    // — and two people touching different elements stop colliding.
    const { a, b } = await pair();
    a.describe!(TAGGED);
    b.describe!(TAGGED);
    const rec = await a.insert("item", { title: "eggs", tags: ["food"] });
    await settle();

    const seenByA = (await a.get("item", rec.id))!.tags as string[];
    const seenByB = (await b.get("item", rec.id))!.tags as string[];
    await Promise.all([
      a.update("item", rec.id, { tags: [...seenByA, "urgent"] }),
      b.update("item", rec.id, { tags: [...seenByB, "cheap"] }),
    ]);
    await settle(600);

    for (const store of [a, b]) {
      const tags = (await store.get("item", rec.id))!.tags as string[];
      expect([...tags].sort()).toEqual(["cheap", "food", "urgent"]);
    }
  });

  it("one person removing a tag while another adds one keeps both intentions", async () => {
    const { a, b } = await pair();
    a.describe!(TAGGED);
    b.describe!(TAGGED);
    const rec = await a.insert("item", { title: "eggs", tags: ["food", "stale"] });
    await settle();

    await Promise.all([
      a.update("item", rec.id, { tags: ["food", "stale", "urgent"] }),
      b.update("item", rec.id, { tags: ["food"] }), // dropped "stale"
    ]);
    await settle(600);

    const tags = (await a.get("item", rec.id))!.tags as string[];
    expect([...tags].sort()).toEqual(["food", "urgent"]);
  });

  it("adopts a field that already holds a plain array, with no migration", async () => {
    // The array written before any of this existed is the base. Without that, switching a field to
    // element-wise merge would empty every record that already had tags.
    const { a } = await pair();
    const rec = await a.insert("item", { title: "eggs", tags: ["food", "cheap"] });
    a.describe!(TAGGED);
    await a.update("item", rec.id, { tags: ["food", "cheap", "urgent"] });
    expect((await a.get("item", rec.id))!.tags).toEqual(["food", "cheap", "urgent"]);
  });

  it("can still be emptied", async () => {
    const { a } = await pair();
    a.describe!(TAGGED);
    const rec = await a.insert("item", { title: "eggs", tags: ["food"] });
    await a.update("item", rec.id, { tags: ["food", "urgent"] });
    await a.update("item", rec.id, { tags: [] });
    expect((await a.get("item", rec.id))!.tags).toEqual([]);
    // And a null clear, which takes the per-element keys with it rather than folding them back on.
    await a.update("item", rec.id, { tags: ["a"] });
    await a.update("item", rec.id, { tags: null as never });
    expect((await a.get("item", rec.id))!.tags).toBeNull();
  });

  it("keeps the per-element bookkeeping out of the record", async () => {
    const { a } = await pair();
    a.describe!(TAGGED);
    const rec = await a.insert("item", { title: "eggs", tags: ["food"] });
    await a.update("item", rec.id, { tags: ["food", "urgent"] });
    const row = (await a.get("item", rec.id))!;
    expect(Object.keys(row).filter((k) => k.includes("\u0002"))).toEqual([]);
    expect(row.tags).toEqual(["food", "urgent"]);
  });

  it("reports activity as the tags the record HAD, not as raw element keys", async () => {
    // KA-36 reads this log to say "Ana changed Tags from food to food, urgent". Reported raw it
    // would say a field called `tags\u0002urgent` became `1`, which is not a sentence.
    const { a } = await pair();
    a.describe!(TAGGED);
    const rec = await a.insert("item", { title: "eggs", tags: ["food"] });
    await a.update("item", rec.id, { tags: ["food", "urgent"] });

    const history = await a.editHistory!("item", rec.id);
    const forTags = history.filter((e) => e.field === "tags");
    expect(history.every((e) => !e.field.includes("\u0002"))).toBe(true);
    expect(forTags.at(-1)!.value).toEqual(["food", "urgent"]);
  });
});

describe("rolling back a mergeable field", () => {
  // `transaction` is a compensating write, not a rollback (see the store header) — it restores the
  // rows it snapshotted. Those rows hold MATERIALISED values: one number for a counter, one array
  // for a set. So restoring them has to clear the contributions they were folded from, or the
  // restored value gets folded on top of the very edits being undone.
  it("restores a counter to what it was, not to double it", async () => {
    const { a } = await pair();
    const rec = await a.insert("item", { title: "eggs", bought: 0 });
    await a.increment!("item", rec.id, "bought", 5);

    await expect(
      a.transaction(async (tx) => {
        await tx.increment!("item", rec.id, "bought", 3);
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");

    expect(Number((await a.get("item", rec.id))!.bought)).toBe(5);
  });

  it("restores a set to the elements it had", async () => {
    const { a } = await pair();
    a.describe!({ item: { tags: { type: "tags" } } } as never);
    const rec = await a.insert("item", { title: "eggs", tags: ["food"] });
    await a.update("item", rec.id, { tags: ["food", "urgent"] });

    await expect(
      a.transaction(async (tx) => {
        await tx.update("item", rec.id, { tags: ["food"] });
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");

    expect((await a.get("item", rec.id))!.tags).toEqual(["food", "urgent"]);
  });
});
