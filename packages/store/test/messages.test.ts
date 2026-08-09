// Messages between the people sharing an app (KA-35).
//
// Two properties carry the design and are pinned here:
//
//   - AUTHOR AND TIME ARE NOT STORED. Only the text is written; `by` and `at` come from the
//     transaction that wrote the key, so a sender cannot claim to be someone else and a message
//     cannot be back-dated. Storing `by` as a field would have made both trivial.
//   - TWO PEOPLE POSTING AT ONCE CANNOT CONFLICT. Each message is its own ULID key, and per-key
//     merge keeps both — the same guarantee an append-only stream gives, without declaring more of
//     cojson's surface.
//
// And chat lives BESIDE the entity tree, so it must never appear as app data.

import { beforeAll, describe, expect, it } from "vitest";
import { LocalNode, cojsonInternals } from "cojson";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import { JazzStore, MemoryStore, ROOM_THREAD, recordThread, type Store } from "../src/index.js";

let crypto: Awaited<ReturnType<typeof WasmCrypto.create>>;
beforeAll(async () => {
  crypto = await WasmCrypto.create();
});

async function solo(): Promise<{ store: JazzStore; accountID: string }> {
  const { node, accountID } = await LocalNode.withNewlyCreatedAccount({
    creationProps: { name: "Ana" },
    crypto,
  });
  const group = node.createGroup();
  const store = new JazzStore({ node: node as never, group: group as never });
  await store.open("chat");
  return { store, accountID: accountID as unknown as string };
}

describe("posting and reading", () => {
  it("keeps messages in order, oldest first", async () => {
    const { store } = await solo();
    await store.postMessage(ROOM_THREAD, "no milk in the store :(");
    await store.postMessage(ROOM_THREAD, "try the one on Rua Nova");

    expect((await store.messages(ROOM_THREAD)).map((m) => m.text)).toEqual([
      "no milk in the store :(",
      "try the one on Rua Nova",
    ]);
  });

  it("attributes the author from the transaction, not from anything supplied", async () => {
    const { store, accountID } = await solo();
    const posted = await store.postMessage(ROOM_THREAD, "hello");

    const [read] = await store.messages(ROOM_THREAD);
    expect(read!.by).toBe(accountID);
    expect(posted.by).toBe(accountID);
    expect(read!.at).toBeInstanceOf(Date);
  });

  it("refuses an empty message", async () => {
    const { store } = await solo();
    await expect(store.postMessage(ROOM_THREAD, "   ")).rejects.toThrow(/nothing to say/i);
  });

  it("trims what it stores", async () => {
    const { store } = await solo();
    await store.postMessage(ROOM_THREAD, "  spaced out  ");
    expect((await store.messages(ROOM_THREAD))[0]!.text).toBe("spaced out");
  });

  it("keeps threads separate — a room and a record are different conversations", async () => {
    const { store } = await solo();
    await store.postMessage(ROOM_THREAD, "general chat");
    await store.postMessage(recordThread("item", "r1"), "about this item");

    expect((await store.messages(ROOM_THREAD)).map((m) => m.text)).toEqual(["general chat"]);
    expect((await store.messages(recordThread("item", "r1"))).map((m) => m.text)).toEqual(["about this item"]);
    expect(await store.messages(recordThread("item", "r2"))).toEqual([]);
  });

  it("windows by `since` and by `limit`", async () => {
    const { store } = await solo();
    await store.postMessage(ROOM_THREAD, "one");
    await new Promise((r) => setTimeout(r, 5));
    const mark = new Date();
    await new Promise((r) => setTimeout(r, 5));
    await store.postMessage(ROOM_THREAD, "two");
    await store.postMessage(ROOM_THREAD, "three");

    expect((await store.messages(ROOM_THREAD, { since: mark })).map((m) => m.text)).toEqual(["two", "three"]);
    // `limit` keeps the most RECENT, which is what a conversation wants.
    expect((await store.messages(ROOM_THREAD, { limit: 1 })).map((m) => m.text)).toEqual(["three"]);
  });

  it("a record's thread dies with the record", async () => {
    // Otherwise the messages outlive the only thing that could ever show them — and would come back
    // attached to the wrong record if that id were reused.
    const { store } = await solo();
    const rec = await store.insert("item", { title: "milk" });
    const thread = recordThread("item", rec.id);
    await store.postMessage(thread, "the oat one");
    await store.postMessage(ROOM_THREAD, "unrelated");

    await store.delete("item", rec.id);

    expect(await store.messages(thread)).toEqual([]);
    // Only that thread. Deleting a record must not take the room with it.
    expect((await store.messages(ROOM_THREAD)).map((m) => m.text)).toEqual(["unrelated"]);
  });

  it("never leaks into the app's data", async () => {
    // Chat sits beside the entity tree. If it showed up as records, an untrusted app could read it
    // through `ctx.query`, which is the one thing this placement exists to prevent.
    const { store } = await solo();
    await store.postMessage(ROOM_THREAD, "private-ish");
    expect(await store.all("chat")).toEqual([]);
    expect(await store.all("room")).toEqual([]);
    expect(await store.all("message")).toEqual([]);
  });
});

describe("stores that cannot do messages say so", () => {
  it("MemoryStore has no message API at all", async () => {
    const s: Store = new MemoryStore();
    await s.open("chat");
    expect(s.postMessage).toBeUndefined();
    expect(s.messages).toBeUndefined();
  });
});

describe("two people talking", () => {
  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

  async function pair() {
    const ana = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Ana" }, crypto });
    const bruno = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Bruno" }, crypto });

    const group = ana.node.createGroup();
    group.addMember(await bruno.node.expectCurrentAccount("bruno"), "writer");

    const anaStore = new JazzStore({ node: ana.node as never, group: group as never });
    await anaStore.open("chat");

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
    await brunoStore.open("chat");
    return { anaStore, brunoStore, ana, bruno };
  }

  it("a message reaches the other person, attributed to the sender", async () => {
    const { anaStore, brunoStore, bruno } = await pair();
    await brunoStore.postMessage(ROOM_THREAD, "there is no milk");
    await settle();

    const [seen] = await anaStore.messages(ROOM_THREAD);
    expect(seen!.text).toBe("there is no milk");
    // The OTHER person — attributing to whoever reads would look right on one device.
    expect(seen!.by).toBe(bruno.accountID);
  });

  it("two people posting at the same moment both survive", async () => {
    // The reason each message is its own key. A single "messages" value would have made this a
    // last-write-wins race, and somebody's message would vanish with no trace.
    const { anaStore, brunoStore } = await pair();
    await Promise.all([
      anaStore.postMessage(ROOM_THREAD, "from Ana"),
      brunoStore.postMessage(ROOM_THREAD, "from Bruno"),
    ]);
    await settle(600);

    const texts = (await anaStore.messages(ROOM_THREAD)).map((m) => m.text).sort();
    expect(texts).toEqual(["from Ana", "from Bruno"]);
    // Both peers agree on the order, which wall-clock alone cannot promise across devices.
    expect((await brunoStore.messages(ROOM_THREAD)).map((m) => m.id)).toEqual(
      (await anaStore.messages(ROOM_THREAD)).map((m) => m.id),
    );
  });

  it("notifies a subscriber when the other person posts", async () => {
    const { anaStore, brunoStore } = await pair();
    let fired = 0;
    const stop = anaStore.subscribeMessages(ROOM_THREAD, () => fired++);
    await settle();
    const before = fired;

    await brunoStore.postMessage(ROOM_THREAD, "knock knock");
    await settle(600);

    expect(fired).toBeGreaterThan(before);
    stop();
  });
});
