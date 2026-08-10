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
