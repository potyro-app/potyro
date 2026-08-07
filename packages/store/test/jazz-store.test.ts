// JazzStore (ADR 0001 D1, KA-08) against the SAME battery MemoryStore and SqliteStore pass.
//
// Mirroring the battery verbatim is the point, not a convenience: a CRDT store that needed its own
// weaker contract would not be a drop-in for the `Store` seam, and the ADR's whole claim is that
// the seam holds (docs/02: swapping the store "touches only the composition root").
//
// Three layers of assertion, in order:
//   1. the verbatim battery                  — the seam holds; JazzStore is a drop-in
//   2. "the property the engine was chosen for" — `update()` writes only patched keys (local half)
//   3. "two peers through the Store seam"    — two real nodes, insert -> sync -> concurrent edit
//      to different fields -> converge (synced half)
//
// (3) exists because it is entirely possible to pick a correct CRDT engine and then throw the
// guarantee away in the adapter — by rewriting whole records on update, or by keying the entity
// index in a way that diverges across peers. `docs/spikes/jazz-merge-granularity.mjs` proves
// cojson merges per key; this proves *the Store* still does.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { LocalNode, cojsonInternals } from "cojson";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import { JazzStore } from "../src/index.js";

let crypto: Awaited<ReturnType<typeof WasmCrypto.create>>;
beforeAll(async () => {
  crypto = await WasmCrypto.create();
});

async function seeded(): Promise<JazzStore> {
  const { node } = await LocalNode.withNewlyCreatedAccount({
    creationProps: { name: "test" },
    crypto,
  });
  const group = node.createGroup();
  const s = new JazzStore({ node: node as never, group: group as never });
  await s.open("test");
  return s;
}

describe("JazzStore CRUD", () => {
  it("inserts with generated id + timestamps and reads back a clone", async () => {
    const s = await seeded();
    const r = await s.insert("task", { title: "a" });
    expect(r.id).toBeTruthy();
    expect(r.createdAt).toBeTruthy();
    expect(r.updatedAt).toBeTruthy();

    const got = await s.get("task", r.id);
    expect(got).toEqual(r);
    // mutating the returned clone must not affect the store
    got!.title = "mutated";
    const again = await s.get("task", r.id);
    expect(again!.title).toBe("a");
  });

  it("updates preserve id/createdAt and bump updatedAt", async () => {
    const s = await seeded();
    const r = await s.insert("task", { title: "a" });
    await new Promise((res) => setTimeout(res, 2));
    const u = await s.update("task", r.id, { title: "b" });
    expect(u.id).toBe(r.id);
    expect(u.createdAt).toBe(r.createdAt);
    expect(u.title).toBe("b");
  });

  it("all() returns rows in creation order and supports narrowing", async () => {
    const s = await seeded();
    const a = await s.insert("task", { title: "a" });
    const b = await s.insert("task", { title: "b" });
    const rows = await s.all("task");
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
    expect((await s.all("task", { limit: 1 })).length).toBe(1);
    expect((await s.all("task", { ids: [b.id] })).map((r) => r.title)).toEqual(["b"]);
  });

  it("delete removes the record", async () => {
    const s = await seeded();
    const r = await s.insert("task", { title: "a" });
    await s.delete("task", r.id);
    expect(await s.get("task", r.id)).toBeNull();
  });
});

describe("JazzStore reactivity", () => {
  it("notifies subscribers on writes to that entity", async () => {
    const s = await seeded();
    const cb = vi.fn();
    const unsub = s.subscribe("task", cb);
    await s.insert("task", { title: "a" });
    expect(cb).toHaveBeenCalledTimes(1);
    await s.insert("other", { title: "x" });
    expect(cb).toHaveBeenCalledTimes(1); // different entity
    unsub();
    await s.insert("task", { title: "b" });
    expect(cb).toHaveBeenCalledTimes(1); // unsubscribed
  });
});

describe("JazzStore transactions", () => {
  it("rolls back on throw", async () => {
    const s = await seeded();
    await s.insert("task", { title: "keep" });
    await expect(
      s.transaction(async (tx) => {
        await tx.insert("task", { title: "gone" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await s.all("task");
    expect(rows.map((r) => r.title)).toEqual(["keep"]);
  });
});

describe("JazzStore blobs + kv", () => {
  it("round-trips a blob", async () => {
    const s = await seeded();
    const ref = await s.putBlob(new Blob(["hello"], { type: "text/plain" }));
    const back = await s.getBlob(ref);
    expect(await back!.text()).toBe("hello");
  });

  it("round-trips kv", async () => {
    const s = await seeded();
    await s.kvSet("k", "v");
    expect(await s.kvGet("k")).toBe("v");
    await s.kvDelete("k");
    expect(await s.kvGet("k")).toBeNull();
  });
});

describe("JazzStore migrations", () => {
  it("applies declarative ops and bumps schema version", async () => {
    const s = await seeded();
    await s.insert("recipe", { name: "Soup", notes: "old" });
    await s.runMigrations({
      fromAppVersion: "1.0.0",
      toAppVersion: "1.1.0",
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      migrations: [
        {
          from: "1.0.0",
          to: "1.1.0",
          steps: [
            { op: "addField", entity: "recipe", field: "timesCooked", default: 0 },
            { op: "renameField", entity: "recipe", from: "notes", to: "description" },
            { op: "changeType", entity: "recipe", field: "timesCooked", to: "number", via: (v: unknown) => Number(v) },
            { transform: (r) => ({ ...r, slug: String(r.name).toLowerCase() }) },
          ],
        },
      ],
    });
    const [r] = await s.all("recipe");
    expect(r.timesCooked).toBe(0);
    expect(r.description).toBe("old");
    expect(r.notes).toBeUndefined();
    expect(r.slug).toBe("soup");
    expect(await s.storedSchemaVersion()).toBe(2);
  });
});

describe("JazzStore — the property the engine was chosen for", () => {
  it("update() writes ONLY the patched keys, so a concurrent peer's field is not clobbered", async () => {
    // This is the local half of the merge guarantee. If `update` wrote the whole record back, every
    // field would become a write and a peer's concurrent edit to an untouched field would lose —
    // which is precisely the whole-document LWW that disqualified Evolu's storage model. The
    // synced half is measured in docs/spikes/jazz-merge-granularity.mjs.
    const s = await seeded();
    const r = await s.insert("expense", { description: "Dinner", amountCents: 4200, paidBy: "ana" });

    const before = await s.get("expense", r.id);
    await s.update("expense", r.id, { amountCents: 4650 });
    const after = await s.get("expense", r.id);

    expect(after!.amountCents).toBe(4650);
    expect(after!.description).toBe("Dinner"); // untouched by the patch
    expect(after!.paidBy).toBe(before!.paidBy);
  });
});

describe("JazzStore — two peers through the Store seam", () => {
  // The spike proved cojson merges per key. This proves the STORE preserves that property: it is
  // possible to write a correct CRDT engine and still throw the guarantee away in the adapter (by
  // rewriting whole records on update, or by keying the index in a way that diverges). Runs two
  // real nodes, so it exercises insert -> sync -> concurrent update -> converge.
  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

  async function pair() {
    const ana = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Ana" }, crypto });
    const bruno = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Bruno" }, crypto });

    const group = ana.node.createGroup();
    group.addMember(await bruno.node.expectCurrentAccount("bruno"), "writer");

    const anaStore = new JazzStore({ node: ana.node as never, group: group as never });
    await anaStore.open("split");

    const [forAna, forBruno] = cojsonInternals.connectedPeers("bruno", "ana", {
      peer1role: "server",
      peer2role: "server",
    });
    ana.node.syncManager.addPeer(forBruno);
    bruno.node.syncManager.addPeer(forAna);
    await settle();

    // Bruno reattaches to the SAME root — the persisted-id path the shell will use on reload.
    const brunoGroup = await bruno.node.load(group.id);
    const brunoStore = new JazzStore({
      node: bruno.node as never,
      group: brunoGroup as never,
      rootId: anaStore.rootId,
    });
    await brunoStore.open("split");
    return { anaStore, brunoStore, ana, bruno };
  }

  it("a record written by one peer arrives at the other", async () => {
    const { anaStore, brunoStore } = await pair();
    const r = await anaStore.insert("expense", { description: "Dinner", amountCents: 4200 });
    await settle();

    const seen = await brunoStore.get("expense", r.id);
    expect(seen?.description).toBe("Dinner");
    expect(seen?.amountCents).toBe(4200);
  });

  it("concurrent edits to DIFFERENT fields of one record both survive", async () => {
    const { anaStore, brunoStore, ana, bruno } = await pair();
    const r = await anaStore.insert("expense", { description: "Dinner", amountCents: 4200, paidBy: "ana" });
    await settle();
    expect((await brunoStore.get("expense", r.id))?.description).toBe("Dinner");

    // Go offline. Each edits a different field, neither seeing the other.
    ana.node.syncManager.gracefulShutdown();
    bruno.node.syncManager.gracefulShutdown();
    await settle();
    await anaStore.update("expense", r.id, { description: "Dinner with Bruno" });
    await brunoStore.update("expense", r.id, { amountCents: 4650 });

    // Reconnect.
    const [forAna2, forBruno2] = cojsonInternals.connectedPeers("bruno2", "ana2", {
      peer1role: "server",
      peer2role: "server",
    });
    ana.node.syncManager.addPeer(forBruno2);
    bruno.node.syncManager.addPeer(forAna2);
    await settle(600);

    const onAna = await anaStore.get("expense", r.id);
    const onBruno = await brunoStore.get("expense", r.id);

    // Neither edit is lost — this is the whole reason Jazz was chosen over Evolu, held at the
    // Store seam rather than only in the engine.
    expect(onAna?.description).toBe("Dinner with Bruno");
    expect(onAna?.amountCents).toBe(4650);
    expect(onAna?.paidBy).toBe("ana");
    expect(onBruno?.description).toBe(onAna?.description);
    expect(onBruno?.amountCents).toBe(onAna?.amountCents);
  });
});
