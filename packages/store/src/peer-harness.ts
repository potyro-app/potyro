// Two connected devices, in one process — so concurrency can be TESTED rather than reasoned about.
//
// Every hazard that matters in a shared app needs two peers writing at once, and nothing outside a
// browser could produce that. Tests built the pair by hand, four times over, each reaching straight
// into cojson. That both duplicated the setup and put engine knowledge in packages whose whole
// design says the engine stays behind this seam (`open-store.ts`: "the shell deliberately does not
// import cojson itself").
//
// So it lives here, exported, and callers get two `Store`s that sync to each other.
//
// Deliberately in `src`, not `test`: the generator's concurrency smoke is a product feature — it is
// how an app is checked before anyone shares it — and it needs exactly this.

import { JazzStore } from "./jazz-store.js";
import type { Store } from "./types.js";

export interface PeerPair {
  /** Two stores over the same space, connected to each other. Genuinely separate nodes. */
  a: Store;
  b: Store;
  /**
   * Wait for writes to cross.
   *
   * Sync is asynchronous, so an assertion made immediately after a write is testing the local copy
   * and nothing else. Every caller needs this and every caller would otherwise pick its own number.
   */
  settle(ms?: number): Promise<void>;
  /** Release both nodes. */
  close(): Promise<void>;
  /** Through a relay only: cut A off from it, as a device that went offline (#255). */
  disconnectA?(): void;
  /**
   * A third device, in a space of its OWN, connected to A: someone who is not a member of the
   * pair's space at all — what a link to one record lets in (record-sharing.ts).
   */
  another?(name?: string): Promise<Store>;
}

/**
 * Stand up two connected peers over a fresh space.
 *
 * The second store attaches to the FIRST one's root id — the same path a real guest takes after
 * accepting an invite, rather than a second space that happens to be wired together.
 */
export async function createPeerPair(appId = "pair"): Promise<PeerPair> {
  // Imported here, not at module scope: this pulls in the wasm crypto, and nothing that merely
  // imports `@potyro/store` should pay for it.
  const [{ LocalNode, cojsonInternals }, { WasmCrypto }] = await Promise.all([
    import("cojson"),
    import("cojson/crypto/WasmCrypto"),
  ]);
  const crypto = await WasmCrypto.create();

  const one = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Peer A" }, crypto });
  const two = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Peer B" }, crypto });

  const group = one.node.createGroup();
  group.addMember(await two.node.expectCurrentAccount("b"), "writer");

  const a = new JazzStore({ node: one.node as never, group: group as never });
  await a.open(appId);

  const [forA, forB] = cojsonInternals.connectedPeers("b", "a", { peer1role: "server", peer2role: "server" });
  one.node.syncManager.addPeer(forB);
  two.node.syncManager.addPeer(forA);

  const settle = (ms = 300): Promise<void> => new Promise((r) => setTimeout(r, ms));
  await settle();

  const groupForTwo = await two.node.load(group.id);
  const b = new JazzStore({ node: two.node as never, group: groupForTwo as never, rootId: a.rootId });
  await b.open(appId);

  const others: Store[] = [];
  return {
    a,
    b,
    settle,
    close: async () => {
      await a.close?.();
      await b.close?.();
      for (const o of others) await o.close?.();
    },
    another: async (name = "Peer C") => {
      const three = await LocalNode.withNewlyCreatedAccount({ creationProps: { name }, crypto });
      const [forThree, forOne] = cojsonInternals.connectedPeers(`one-${others.length}`, `three-${others.length}`, { peer1role: "server", peer2role: "server" });
      three.node.syncManager.addPeer(forOne);
      one.node.syncManager.addPeer(forThree);
      const store = new JazzStore({ node: three.node as never, group: three.node.createGroup() as never });
      await store.open(appId);
      others.push(store);
      return store;
    },
  };
}

/**
 * Two members of a space who reach each other through a RELAY, as real devices do (#255).
 *
 * `createPeerPair` connects the two directly, each as the other's server, so each pushes everything
 * it has to the other — including the bytes of every file. A relay forwards a CoValue only to a
 * client that asked for it, which is what makes a shared app's files arrive on demand. Anything
 * claiming "not fetched until read" has to be tested through one.
 */
export async function createRelayedPair(appId = "relayed", opts: { spaceBudget?: number } = {}): Promise<PeerPair> {
  const [{ LocalNode, cojsonInternals }, { WasmCrypto }] = await Promise.all([import("cojson"), import("cojson/crypto/WasmCrypto")]);
  const crypto = await WasmCrypto.create();
  const relay = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Relay" }, crypto });
  const one = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Peer A" }, crypto });
  const two = await LocalNode.withNewlyCreatedAccount({ creationProps: { name: "Peer B" }, crypto });
  const attach = (client: typeof one, name: string): void => {
    const [relayForClient, clientForRelay] = cojsonInternals.connectedPeers("relay", name, { peer1role: "server", peer2role: "client" });
    client.node.syncManager.addPeer(relayForClient);
    relay.node.syncManager.addPeer(clientForRelay);
  };
  attach(one, "a");
  attach(two, "b");

  const group = one.node.createGroup();
  group.addMember(await two.node.expectCurrentAccount("b"), "writer");
  const a = new JazzStore({ node: one.node as never, group: group as never, spaceBudget: opts.spaceBudget });
  await a.open(appId);

  const settle = (ms = 300): Promise<void> => new Promise((r) => setTimeout(r, ms));
  await settle();
  const groupForTwo = await two.node.load(group.id);
  const b = new JazzStore({ node: two.node as never, group: groupForTwo as never, rootId: a.rootId, spaceBudget: opts.spaceBudget });
  await b.open(appId);
  return {
    a,
    b,
    settle,
    close: async () => {
      await a.close?.();
      await b.close?.();
    },
    disconnectA: () => one.node.syncManager.removePeer("relay" as never),
  };
}
