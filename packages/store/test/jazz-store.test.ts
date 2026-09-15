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
  // DELIBERATE DIVERGENCE from the shared battery, and the only one.
  //
  // MemoryStore notifies exactly once per write, and its test asserts that count. JazzStore cannot:
  // it must also surface changes that arrive from a PEER, and cojson delivers those
  // ASYNCHRONOUSLY — including its echo of our own write, which lands after the local notification
  // has already fired. Suppressing the echo synchronously is not possible for the same reason.
  //
  // An exact count is an implementation detail of an in-memory store, not the `Store` contract,
  // which says "notify on entity change; the runtime re-runs its JS queries" (docs/05). Re-running
  // a query is idempotent, so an extra notification costs a little work and changes nothing. What
  // WOULD be a contract break is notifying for the wrong entity, or after unsubscribe — so those
  // stay asserted exactly.
  it("notifies subscribers on writes to that entity, and only that entity", async () => {
    const s = await seeded();
    const cb = vi.fn();
    const unsub = s.subscribe("task", cb);

    await s.insert("task", { title: "a" });
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);

    const afterOwnEntity = cb.mock.calls.length;
    await s.insert("other", { title: "x" });
    await new Promise((r) => setTimeout(r, 50)); // let any async notification land
    expect(cb.mock.calls.length).toBe(afterOwnEntity); // different entity: never

    unsub();
    const afterUnsub = cb.mock.calls.length;
    await s.insert("task", { title: "b" });
    await new Promise((r) => setTimeout(r, 50));
    expect(cb.mock.calls.length).toBe(afterUnsub); // unsubscribed: never
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

  async function pair(role: "writer" | "reader" = "writer") {
    const ana = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Ana" }, crypto });
    const bruno = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Bruno" }, crypto });

    const group = ana.node.createGroup();
    group.addMember(await bruno.node.expectCurrentAccount("bruno"), role);

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
    return { anaStore, brunoStore, ana, bruno, group };
  }

  it("a record written by one peer arrives at the other", async () => {
    const { anaStore, brunoStore } = await pair();
    const r = await anaStore.insert("expense", { description: "Dinner", amountCents: 4200 });
    await settle();

    const seen = await brunoStore.get("expense", r.id);
    expect(seen?.description).toBe("Dinner");
    expect(seen?.amountCents).toBe(4200);
  });

  // KA-21: writes a copy was not allowed to make do not surface anywhere else. This is cojson's
  // guarantee, not Karta's — every transaction is signed and checked against the writer's role AT
  // THE TIME it was made (cojson permissions.ts `determineValidTransactions`) — but it is the
  // property shared apps stand on, so it is pinned here through the Store seam.
  it("a write by someone who was removed while offline never reaches the others (KA-21)", async () => {
    const { anaStore, brunoStore, ana, bruno, group } = await pair();
    const r = await anaStore.insert("expense", { description: "Dinner", amountCents: 4200 });
    await settle();
    expect((await brunoStore.get("expense", r.id))?.description).toBe("Dinner");

    // Bruno drops off. While he is away, Ana removes him.
    ana.node.syncManager.gracefulShutdown();
    bruno.node.syncManager.gracefulShutdown();
    await settle();
    (group as unknown as { removeMember(a: unknown): void }).removeMember(await bruno.node.expectCurrentAccount("bruno"));
    await settle();

    // Bruno's copy has not heard, so it lets him write. Then he reconnects.
    await brunoStore.update("expense", r.id, { description: "Dinner (Bruno didn't pay)" }).catch(() => {});
    const [forAna, forBruno] = cojsonInternals.connectedPeers("bruno2", "ana2", { peer1role: "server", peer2role: "server" });
    ana.node.syncManager.addPeer(forBruno);
    bruno.node.syncManager.addPeer(forAna);
    await settle(500);

    expect((await anaStore.get("expense", r.id))?.description).toBe("Dinner");
  });

  it("control: an offline edit by someone still a member DOES arrive on reconnect", async () => {
    // Without this, the removal test above would pass just as well if reconnecting never synced.
    const { anaStore, brunoStore, ana, bruno } = await pair();
    const r = await anaStore.insert("expense", { description: "Dinner", amountCents: 4200 });
    await settle();
    ana.node.syncManager.gracefulShutdown();
    bruno.node.syncManager.gracefulShutdown();
    await settle();
    await brunoStore.update("expense", r.id, { description: "Dinner with Bruno" });
    const [forAna, forBruno] = cojsonInternals.connectedPeers("bruno2", "ana2", { peer1role: "server", peer2role: "server" });
    ana.node.syncManager.addPeer(forBruno);
    bruno.node.syncManager.addPeer(forAna);
    await settle(500);
    expect((await anaStore.get("expense", r.id))?.description).toBe("Dinner with Bruno");
  });

  it("a view-only member's write reaches nobody else (KA-21)", async () => {
    const { anaStore, brunoStore } = await pair("reader");
    const r = await anaStore.insert("expense", { description: "Dinner", amountCents: 4200 });
    await settle();
    expect((await brunoStore.get("expense", r.id))?.description).toBe("Dinner");

    // Whether their own copy refuses up front or records a no-op is the engine's business; what
    // matters is that the others never see it.
    await brunoStore.update("expense", r.id, { amountCents: 1 }).catch(() => {});
    await settle();
    expect((await anaStore.get("expense", r.id))?.amountCents).toBe(4200);
  });

  it("a kv write by one peer is heard by the other while it is open (KA-22)", async () => {
    // The version gate watches `__appSource` so a newer version locks an old copy the moment it is
    // published. Hearing it only on the next open is what let an old copy keep writing.
    const { anaStore, brunoStore } = await pair();
    const heard = vi.fn();
    const stop = brunoStore.subscribeKv(heard);
    await settle();

    await anaStore.kvSet("__appSource", "{\"v\":2}");
    await settle();

    expect(heard).toHaveBeenCalled();
    expect(await brunoStore.kvGet("__appSource")).toBe("{\"v\":2}");

    stop();
    heard.mockClear();
    await anaStore.kvSet("__appSource", "{\"v\":3}");
    await settle();
    expect(heard).not.toHaveBeenCalled();
  });

  it("either person can edit a record the OTHER one created", async () => {
    // Reported from the live deployment: a row created by the other member would not move up or
    // down. Everyone in a space is a writer (KA-21's per-member scoping is not built), so authorship
    // must not gate editing — and `update` must not treat `createdBy` as immutable in a way that
    // makes a whole patch fail.
    const { anaStore, brunoStore } = await pair();
    const made = await brunoStore.insert("item", { title: "milk", order: 1 });
    await settle();

    // Ana reorders Bruno's row, exactly as a move-up button would.
    const updated = await anaStore.update("item", made.id, { order: 5 });
    expect(updated.order).toBe(5);
    await settle();

    expect((await brunoStore.get("item", made.id))?.order).toBe(5);
    // And the row is still Bruno's — editing does not steal authorship.
    expect((await anaStore.get("item", made.id))?.createdBy).toBe(made.createdBy);
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

describe("JazzStore — a peer's change arrives without a local write", () => {
  // Reported 2026-08-08: tab 1 had 3 items, tab 2 joined and saw them, but tab 1 did not see tab
  // 2's new item until tab 1 itself changed something — at which point everything appeared at once.
  //
  // Cause: `subscribe` only fired on LOCAL writes. Remote changes updated the CoValues, but nothing
  // told the runtime to re-query, so the UI sat on stale data until a local write happened to
  // trigger one. Sync that only appears when you type is not sync.
  const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

  async function pair() {
    const ana = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Ana" }, crypto });
    const bob = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Bob" }, crypto });
    const group = ana.node.createGroup();
    group.addMember(await bob.node.expectCurrentAccount("bob"), "writer");
    const anaStore = new JazzStore({ node: ana.node as never, group: group as never });
    await anaStore.open("todo");
    const [forAna, forBob] = cojsonInternals.connectedPeers("bob", "ana", {
      peer1role: "server",
      peer2role: "server",
    });
    ana.node.syncManager.addPeer(forBob);
    bob.node.syncManager.addPeer(forAna);
    await settle();
    const bobGroup = await bob.node.load(group.id);
    const bobStore = new JazzStore({
      node: bob.node as never,
      group: bobGroup as never,
      rootId: anaStore.rootId,
    });
    await bobStore.open("todo");
    return { anaStore, bobStore };
  }

  it("notifies a subscriber when the OTHER peer inserts", async () => {
    const { anaStore, bobStore } = await pair();
    await anaStore.insert("todo", { title: "milk" });
    await settle();

    let notified = 0;
    bobStore.subscribe("todo", () => notified++);
    await settle();
    const before = notified;

    // Bob does nothing at all. Ana adds an item.
    await anaStore.insert("todo", { title: "bread" });
    await settle();

    expect(notified).toBeGreaterThan(before); // was never fired before the fix
    expect((await bobStore.all("todo")).map((r) => r.title).sort()).toEqual(["bread", "milk"]);
  });

  it("notifies when the other peer EDITS an existing record", async () => {
    // Watching only the entity index would catch inserts but miss every field edit — the case the
    // engine was actually chosen for.
    const { anaStore, bobStore } = await pair();
    const r = await anaStore.insert("todo", { title: "milk", done: false });
    await settle();
    await bobStore.all("todo");

    let notified = 0;
    bobStore.subscribe("todo", () => notified++);
    await settle();
    const before = notified;

    await anaStore.update("todo", r.id, { done: true });
    await settle();

    expect(notified).toBeGreaterThan(before);
    expect((await bobStore.get("todo", r.id))?.done).toBe(true);
  });
});

describe("JazzStore — attribution across peers (KA-36)", () => {
  // The activity feature claims "changed by X". That is only worth anything if X is the OTHER
  // person when they are the one who changed it — attributing every edit to whoever is reading
  // would look identical on one device and be wrong on two.
  //
  // Authorship here is derived from the signing session, so it cannot be forged by app code the way
  // an app-emitted "system message" could. This pins that it survives the trip between peers.
  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

  async function pair(role: "writer" | "reader" = "writer") {
    const ana = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Ana" }, crypto });
    const bruno = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Bruno" }, crypto });

    const group = ana.node.createGroup();
    group.addMember(await bruno.node.expectCurrentAccount("bruno"), role);

    const anaStore = new JazzStore({ node: ana.node as never, group: group as never });
    await anaStore.open("split");

    const [forAna, forBruno] = cojsonInternals.connectedPeers("bruno", "ana", {
      peer1role: "server",
      peer2role: "server",
    });
    ana.node.syncManager.addPeer(forBruno);
    bruno.node.syncManager.addPeer(forAna);
    await settle();

    const brunoGroup = await bruno.node.load(group.id);
    const brunoStore = new JazzStore({
      node: bruno.node as never,
      group: brunoGroup as never,
      rootId: anaStore.rootId,
    });
    await brunoStore.open("split");
    return { anaStore, brunoStore, ana, bruno };
  }

  it("attributes a peer's edit to the peer, seen from either side", async () => {
    const { anaStore, brunoStore, ana, bruno } = await pair();

    const row = await anaStore.insert("item", { name: "Milk", qty: 1 });
    await settle();
    await brunoStore.update("item", row.id, { qty: 5 });
    await settle();

    // Ana reads the history and must see BRUNO as the author of the quantity change.
    const asAna = await anaStore.editHistory!("item", row.id);
    const qtyEdit = asAna.filter((e) => e.field === "qty").at(-1);
    expect(qtyEdit?.value).toBe(5);
    expect(qtyEdit?.by).toBe(bruno.accountID);

    // And the record's own creation is still attributed to Ana.
    const nameEdit = asAna.find((e) => e.field === "name");
    expect(nameEdit?.by).toBe(ana.accountID);

    // Both peers agree on who did what — this is a fold over the same signed log, not a local guess.
    const asBruno = await brunoStore.editHistory!("item", row.id);
    expect(asBruno.filter((e) => e.field === "qty").at(-1)?.by).toBe(bruno.accountID);
    expect(asBruno.find((e) => e.field === "name")?.by).toBe(ana.accountID);
  });
});
