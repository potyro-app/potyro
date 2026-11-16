// The gate between the real things: `jazz-run`'s sync server behind it (in memory), and cojson nodes
// in front of it over the same reconnecting websocket peer the shell uses
// (packages/store/src/jazz-backend.ts, `attachRelay`).
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { LocalNode, type RawCoMap } from "cojson";
import { WasmCrypto } from "cojson/crypto/WasmCrypto";
import { WebSocketPeerWithReconnection } from "cojson-transport-ws";
import { startSyncServer } from "jazz-run/startSyncServer";
import { WebSocket } from "ws";
import { startSyncGate, type GateOptions, type SyncGate } from "../src/gate.ts";
import { fakeRelay, cleanup as cleanupFakes, open, until } from "./helpers.ts";

const stops: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
  await cleanupFakes();
});

async function realRelay(): Promise<number> {
  const server = (await startSyncServer({ host: "127.0.0.1", port: "0", inMemory: true, db: "" })) as unknown as Server;
  stops.push(() => void server.close());
  return (server.address() as AddressInfo).port;
}

async function gateTo(port: number, opts: Partial<GateOptions> = {}): Promise<{ gate: SyncGate; url: string }> {
  const gate = await startSyncGate({ port: 0, host: "127.0.0.1", upstream: { host: "127.0.0.1", port }, ...opts });
  stops.push(() => gate.close());
  return { gate, url: `ws://127.0.0.1:${(gate.server.address() as AddressInfo).port}/` };
}

/**
 * `ws` raises an error nobody listens for as an exception; a browser's WebSocket does not. The peer
 * lets go of its listeners when it is disabled, so a connection still opening then would throw here.
 */
class QuietSocket extends WebSocket {
  constructor(url: string) {
    super(url);
    this.on("error", () => {});
  }
}

/** A device: a cojson node with its own account, attached to `url` the way the shell attaches its relay. */
async function device(name: string, url: string) {
  const crypto = await WasmCrypto.create();
  const { node } = await LocalNode.withNewlyCreatedAccount({ creationProps: { name }, crypto });
  const peer = new WebSocketPeerWithReconnection({
    peer: url,
    reconnectionTimeout: undefined,
    addPeer: (p) => node.syncManager.addPeer(p),
    removePeer: (p) => node.syncManager.removePeer(p.id),
    WebSocketConstructor: QuietSocket as never,
  });
  peer.enable();
  stops.push(async () => {
    peer.disable();
    await node.gracefulShutdown();
  });
  return { node, peer };
}

describe("the gate in front of jazz-run", () => {
  it("syncs a value from one device to another through it, a long one too", async () => {
    const { url, gate } = await gateTo(await realRelay());
    const ana = await device("Ana", url);
    const bo = await device("Bo", url);

    const group = ana.node.createGroup();
    group.addMember("everyone", "writer");
    const map = group.createMap();
    const long = "potyro ".repeat(60_000); // 420 kB in one edit: several reads, one message
    map.set("title", "Groceries", "trusting");
    map.set("body", long, "trusting");

    const seen = (await bo.node.load(map.id)) as RawCoMap | "unavailable";
    if (seen === "unavailable") throw new Error("the value did not arrive through the gate");
    await until(() => seen.get("body") === long, 8000);
    expect(seen.get("title")).toBe("Groceries");

    // And back: Bo's edit reaches Ana.
    seen.set("title", "Groceries, by Bo", "trusting");
    await until(() => map.get("title") === "Groceries, by Bo", 8000);
    expect(gate.stats().accepted).toBe(2);
    expect(gate.stats().bytesUp).toBeGreaterThan(420_000);
    expect(gate.stats().closed).toEqual({});
  }, 20_000);

  it("keeps every connection when many arrive at the relay in the same instant: the relay is not told they are one peer", async () => {
    // jazz-run names a peer by the address it is told and the millisecond it connected, and closes
    // the peer it already has under a name when another takes it. Behind a gate that told it
    // nothing, every connection had the gate's address, and two in one millisecond were one peer.
    const { url, gate } = await gateTo(await realRelay());
    const sockets = [...Array(40)].map(() => new QuietSocket(url));
    const closed: number[] = [];
    const greeted = sockets.map((ws) => {
      return new Promise<void>((r) => {
        ws.once("message", () => r());
        ws.on("close", (code) => {
          closed.push(code);
          r();
        });
      });
    });
    stops.push(() => sockets.forEach((ws) => ws.terminate()));
    await Promise.all(greeted); // the relay's first ping reached each of them (or it was closed, and the test says so below)
    await new Promise((r) => setTimeout(r, 200)); // a wait can only miss a fault here, never make one
    expect(closed).toEqual([]);
    expect(gate.stats().connections).toBe(40);
  }, 20_000);

  it("keeps syncing while an address is slowed: the relay's pings still reach the client", async () => {
    // 100 kB a second with almost no burst: the 420 kB edit takes seconds, during which the client
    // would drop the connection if it heard nothing for 10 s. Slowing holds only the way up.
    const { url, gate } = await gateTo(await realRelay(), { limits: { bytesPerSecond: 100_000, byteBurst: 20_000 } });
    const ana = await device("Ana", url);
    const bo = await device("Bo", url);
    const group = ana.node.createGroup();
    group.addMember("everyone", "reader");
    const map = group.createMap();
    const long = "potyro ".repeat(60_000);
    map.set("body", long, "trusting");
    // The edit is seconds on its way up; only then is there anything for Bo to load.
    await until(() => gate.stats().bytesUp > 420_000, 15_000);
    let seen: RawCoMap | "unavailable" = "unavailable";
    for (let i = 0; i < 5 && seen === "unavailable"; i++) seen = (await bo.node.load(map.id)) as RawCoMap | "unavailable";
    if (seen === "unavailable") throw new Error("the value did not arrive through the gate");
    const arrived = seen;
    await until(() => arrived.get("body") === long, 15_000);
    expect(gate.stats().heldMs).toBeGreaterThan(2000);
    expect(gate.stats().closed).toEqual({});
    expect(ana.peer.connected).toBe(true);
  }, 30_000);
});

describe("the shell's client against a gate that refuses it", () => {
  it("backs off instead of hammering, and comes back by itself when there is room", async () => {
    const relay = await fakeRelay();
    const { url, gate } = await gateTo(relay.port, { limits: { connectionsPerAddress: 1 } });
    const holder = await open(url); // the address's one connection is taken

    const node = await device("Ana", url);
    const refusedAfter = async (ms: number): Promise<number> => {
      await new Promise((r) => setTimeout(r, ms));
      return gate.stats().refused["too-many-connections"] ?? 0;
    };
    // The library waits 500 ms × the number of attempts so far: tries at about 0, 0.5, 1.5 and 3 s.
    // A client that retried at once would have made hundreds by now.
    const early = await refusedAfter(2000);
    expect(early).toBeGreaterThanOrEqual(2);
    expect(early).toBeLessThanOrEqual(4);
    const later = await refusedAfter(2000);
    expect(later - early).toBeLessThanOrEqual(2);
    expect(node.peer.closed).toBe(true);

    holder.ws.close();
    await until(() => node.peer.closed === false, 8000);
    expect(gate.stats().accepted).toBe(2);
  }, 20_000);

  it("is not let back in early by a connection the gate closed for the day: a refused upgrade never resets the wait", async () => {
    const relay = await fakeRelay();
    const { url, gate } = await gateTo(relay.port, { limits: { bytesPerAddressDay: 100_000 } });
    const { node, peer } = await device("Ana", url);
    // Connected, and known to be: the relay's first message came, which is what sets the client's
    // wait back to nothing.
    await until(() => peer.closed === false, 8000);
    const map = node.createGroup().createMap();
    map.set("body", "x".repeat(150_000), "trusting");
    await until(() => (gate.stats().closed[4021] ?? 0) === 1, 8000);
    await new Promise((r) => setTimeout(r, 3000));
    // Closed once mid-session, then refused at the door: 500 ms, 1 s, 1.5 s… not a loop.
    expect(gate.stats().accepted).toBe(1);
    expect(gate.stats().refused["over-today"] ?? 0).toBeLessThanOrEqual(4);
    expect(gate.stats().refused["over-today"] ?? 0).toBeGreaterThanOrEqual(1);
  }, 20_000);
});
