// Live connections in every runner (docs/28): one app, written once as source, run as a trusted
// function, in the QuickJS isolate and in the browser realm, against the in-memory socket server.
// Each connects, sends text and bytes, writes what comes back as records from inside its callbacks
// (so `ctx` must still work after the call that opened the socket returned), joins a room with
// another member, and hears its connections close — the same records in every box.

import { afterAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities, createFakeSockets } from "@potyro/capabilities";
import { defineApp } from "potyro";
import { createHost, openSocketsOf, type LoadedApp, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { RUNNERS, liveThreads, type Runner } from "./runners.js";

const ROOM = "test-room-000000000000000";

// Module state: the connections outlive the actions that open them.
const PRELUDE = "var sock = null, room = null;";
const ACTIONS: Record<string, string> = {
  connect: `async function (r, ctx) {
    sock = await ctx.caps.network.socket("wss://echo.test/live", { protocols: ["v1"] });
    sock.onMessage(function (d) { ctx.create("msg", { text: typeof d === "string" ? "text " + d : "bytes " + Array.from(d).join(",") }); });
    sock.onClose(function (c) { ctx.create("msg", { text: "closed " + c.why + " " + c.code }); });
    await ctx.create("msg", { text: "open " + sock.readyState + " " + sock.protocol });
    await sock.send("hello");
    await sock.send(new Uint8Array([1, 2, 255]));
  }`,
  hangUp: `async function (r, ctx) { sock.close(); }`,
  refused: `async function (r, ctx) {
    var codes = [];
    try { await ctx.caps.network.socket("wss://evil.example/x"); codes.push("connected"); } catch (e) { codes.push(e.code); }
    try { await sock.send("after close"); codes.push("sent"); } catch (e) { codes.push(e.code); }
    await ctx.create("msg", { text: "codes " + codes.join(",") });
  }`,
  join: `async function (r, ctx) {
    room = await ctx.caps.network.room("${ROOM}", { name: "Ana" });
    room.onMessage(function (d) { ctx.create("msg", { text: "peer " + d }); });
    room.onPresence(function (e) { ctx.create("msg", { text: e.type + " " + e.member.name + " (" + room.members.length + ")" }); });
    room.onClose(function (c) { ctx.create("msg", { text: "room closed " + c.why + " " + c.code }); });
    await ctx.create("msg", { text: "me " + room.me.name + " with " + room.members.map(function (m) { return m.name; }).join(",") });
    await room.send("hi from Ana");
  }`,
};

const definition = {
  id: "live",
  name: "Live",
  version: "1.0.0",
  schemaVersion: 1,
  permissions: { network: { hosts: ["echo.test"], rooms: true } },
  entities: {
    run: { fields: { out: { type: "text" } } },
    msg: { fields: { text: { type: "text" } } },
  },
  pages: [{ id: "all", title: "All", view: { type: "list", entity: "msg", display: { primary: "text" } } }],
};

const nav: NavBridge = { navigate: () => {} };

afterAll(async () => {
  await Promise.all([...liveThreads].map((w) => w.terminate()));
});

async function until(cond: () => Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function scenario(trust: "trusted" | Runner) {
  const store = new MemoryStore();
  await store.open("live");
  const fake = createFakeSockets();
  const asked: string[] = [];
  const ui: UiBridge = { toast: () => {}, confirm: async (m) => (asked.push(m), true), prompt: async () => null, pick: async () => null };
  const caps = new FakeCapabilities({ sockets: fake.cap });
  const host = trust === "trusted" ? createHost() : createHost({ loadIsolated: await trust.loader(store) });
  const fns = Object.fromEntries(Object.entries(ACTIONS).map(([k, src]) => [k, src]));
  let loaded: LoadedApp;
  if (trust === "trusted") {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const actions = new Function(`${PRELUDE} return { ${Object.entries(fns).map(([k, v]) => `${k}: ${v}`).join(",")} };`)() as Record<string, unknown>;
    loaded = await host.load({ kind: "module", app: defineApp({ ...definition, entities: { ...definition.entities, run: { ...definition.entities.run, actions } } } as never) });
  } else {
    const actions = `{${Object.entries(fns).map(([k, v]) => `"${k}":${v}`).join(",")}}`;
    const json = JSON.stringify(definition).replace('"run":{"fields":{"out":{"type":"text"}}}', `"run":{"fields":{"out":{"type":"text"}},"actions":${actions.replace(/\$/g, "$$$$")}}`);
    loaded = await host.load({ kind: "bundle", code: `${PRELUDE} globalThis.__potyroApp = ${json};`, provenance: "untrusted" });
  }
  const row = await store.insert("run", { out: "" });
  const act = (key: string) => loaded.callAction("run", key, { ...row } as never, host.makeCtx(loaded, { store, caps, ui, nav } as MakeCtxBase));
  const texts = async () => (await store.all("msg")).map((m) => String(m.text));
  const has = (t: string) => async () => (await texts()).includes(t);

  await act("connect");
  await until(has("bytes 1,2,255"));
  await until(has("text hello"));
  await act("hangUp");
  await until(has("closed app 1000"));
  await act("refused");
  await until(async () => (await texts()).some((t) => t.startsWith("codes ")));

  const bo = fake.joinRoom(ROOM, "Bo");
  await act("join");
  await until(async () => bo.received.includes("hi from Ana"));
  bo.send("hi from Bo");
  await until(has("peer hi from Bo"));
  const cy = fake.joinRoom(ROOM, "Cy");
  await until(has("join Cy (2)"));
  cy.leave();
  await until(has("leave Cy (1)"));
  // Leaving the app: the room hears why (the echo socket was closed by the app already).
  fake.cap.closeAll("left");
  await until(has("room closed left 1001"));

  const out = (await texts()).sort();
  loaded.dispose();
  return { out, asked, offered: fake.connections[0]!.protocols, sent: fake.connections[0]!.received };
}

const EXPECTED = [
  "bytes 1,2,255",
  "closed app 1000",
  "codes not-allowed-host,closed",
  "join Cy (2)",
  "leave Cy (1)",
  "me Ana with Bo",
  "open open v1",
  "peer hi from Bo",
  "room closed left 1001",
  "text hello",
].sort();

describe("ctx.caps.network.socket and .room in every runner", () => {
  it("trusted: connects, carries text and bytes, joins a room, hears every close", { timeout: 30_000 }, async () => {
    const { out, asked, offered, sent } = await scenario("trusted");
    // A trusted app is not held to the manifest's hosts: the connection the sealed ones are refused opens.
    expect(out).toEqual(expect.arrayContaining(EXPECTED.map((t) => (t === "codes not-allowed-host,closed" ? "codes connected,closed" : t))));
    expect(asked).toEqual([]);
    expect(offered).toEqual(["v1"]);
    expect(sent).toEqual(["hello", new Uint8Array([1, 2, 255])]);
  });

  it("realm: a box the watchdog stops takes its connections with it", async () => {
    const realm = RUNNERS.find((r) => r.name === "realm")!;
    const store = new MemoryStore();
    await store.open("live");
    const fake = createFakeSockets();
    const caps = new FakeCapabilities({ sockets: fake.cap });
    const host = createHost({ loadIsolated: await realm.loader(store) });
    const json = JSON.stringify(definition).replace('"run":{"fields":{"out":{"type":"text"}}}', `"run":{"fields":{"out":{"type":"text"}},"actions":{"connect":${ACTIONS.connect!.replace(/\$/g, "$$$$")}}}`);
    const loaded = await host.load({ kind: "bundle", code: `${PRELUDE} globalThis.__potyroApp = ${json};`, provenance: "untrusted" });
    const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };
    const row = await store.insert("run", { out: "" });
    await loaded.callAction("run", "connect", { ...row } as never, host.makeCtx(loaded, { store, caps, ui, nav } as MakeCtxBase));
    expect(fake.cap.openCount).toBe(1);
    expect(openSocketsOf(loaded)).toBe(1);
    (loaded as unknown as { kill(reason: string): void }).kill("a test stopped it");
    expect(openSocketsOf(loaded)).toBe(0);
    await until(async () => fake.connections[0]!.closed && fake.cap.openCount === 0);
    loaded.dispose();
  }, 60_000);

  for (const runner of RUNNERS) {
    it(`${runner.name}: the same records as trusted, after asking once per host`, async () => {
      const { out, asked, offered, sent } = await scenario(runner);
      expect(out).toEqual(expect.arrayContaining(EXPECTED));
      expect(asked).toEqual(["“Live” wants a live connection to echo.test.", "“Live” wants a live connection to Potyro’s rooms."]);
      expect(offered).toEqual(["v1"]);
      expect(sent).toEqual(["hello", new Uint8Array([1, 2, 255])]);
    }, 60_000);
  }
});
