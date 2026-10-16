// A sealed call's budget (about a second) is the APP's time: waiting on the network is not the app
// running away, any more than a question to the person is (docs/28 §5). A connect or a fetch that
// takes longer than the whole budget must not get the call killed, in either sealed runner — and
// the app's own spinning still must.

import { afterAll, describe, expect, it } from "vitest";
import { MemoryStore } from "@potyro/store";
import { FakeCapabilities, createFakeSockets, type SocketCap } from "@potyro/capabilities";
import { createHost, type MakeCtxBase, type NavBridge, type UiBridge } from "../src/index.js";
import { RUNNERS, liveThreads } from "./runners.js";

const BUDGET_MS = 300;
const SLOW_MS = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ACTIONS: Record<string, string> = {
  connect: `async function (r, ctx) {
    var s = await ctx.caps.network.socket("wss://slow.test/live");
    await ctx.create("msg", { text: "open " + s.readyState });
    s.close();
  }`,
  room: `async function (r, ctx) {
    var room = await ctx.caps.network.room("budget-room-0000000000000");
    await ctx.create("msg", { text: "room " + room.readyState });
    room.close();
  }`,
  fetch: `async function (r, ctx) {
    var res = await ctx.caps.network.fetch("https://slow.test/data");
    await ctx.create("msg", { text: "fetched " + res.status + " " + (await res.text()) });
  }`,
  spin: `async function (r, ctx) { var end = Date.now() + ${SLOW_MS}; while (Date.now() < end) {} }`,
};

const definition = (actions: string) =>
  `globalThis.__potyroApp = ${JSON.stringify({
    id: "budget",
    name: "Budget",
    version: "1.0.0",
    schemaVersion: 1,
    permissions: { network: { hosts: ["slow.test"], rooms: true } },
    entities: { run: { fields: { out: { type: "text" } } }, msg: { fields: { text: { type: "text" } } } },
    pages: [{ id: "all", title: "All", view: { type: "list", entity: "msg", display: { primary: "text" } } }],
  }).replace('"run":{"fields":{"out":{"type":"text"}}}', `"run":{"fields":{"out":{"type":"text"}},"actions":${actions}}`)};`;

const nav: NavBridge = { navigate: () => {} };
const ui: UiBridge = { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null };

afterAll(async () => {
  await Promise.all([...liveThreads].map((w) => w.terminate()));
});

/** The page's sockets, but every connection takes SLOW_MS to open — a far server, a slow network. */
function slowSockets(): SocketCap {
  const fake = createFakeSockets();
  const cap = fake.cap;
  return {
    ...cap,
    roomsUrl: cap.roomsUrl,
    get openCount() {
      return cap.openCount;
    },
    open: async (url, opts, events) => {
      await sleep(SLOW_MS);
      return cap.open(url, opts, events);
    },
  };
}

describe("network waits do not count against a sealed call's budget", () => {
  for (const runner of RUNNERS) {
    const supported = runner.name === "realm" ? ["connect", "room", "fetch"] : ["connect", "room"];
    for (const op of supported) {
      it(`${runner.name}: a ${op} slower than the whole budget still finishes`, async () => {
        const store = new MemoryStore();
        await store.open("budget");
        const killed: string[] = [];
        const caps = new FakeCapabilities({
          sockets: slowSockets(),
          fetch: async () => {
            await sleep(SLOW_MS);
            return new Response("ok", { status: 200 });
          },
        });
        const host = createHost({ loadIsolated: await runner.loader(store, { timeoutMs: BUDGET_MS, onKill: (r) => killed.push(r) }) });
        const actions = `{${Object.entries(ACTIONS).map(([k, v]) => `"${k}":${v}`).join(",")}}`;
        const loaded = await host.load({ kind: "bundle", code: definition(actions.replace(/\$/g, "$$$$")), provenance: "untrusted" });
        const row = await store.insert("run", { out: "" });
        const started = Date.now();
        await loaded.callAction("run", op, { ...row } as never, host.makeCtx(loaded, { store, caps, ui, nav } as MakeCtxBase));
        expect(Date.now() - started).toBeGreaterThanOrEqual(SLOW_MS - 50);
        const texts = (await store.all("msg")).map((m) => String(m.text));
        expect(texts).toEqual([op === "connect" ? "open open" : op === "room" ? "room open" : "fetched 200 ok"]);
        expect(killed).toEqual([]);
        loaded.dispose();
      }, 30_000);
    }

    it(`${runner.name}: the app's own spinning is still stopped`, async () => {
      const store = new MemoryStore();
      await store.open("budget");
      const host = createHost({ loadIsolated: await runner.loader(store, { timeoutMs: BUDGET_MS }) });
      const actions = `{${Object.entries(ACTIONS).map(([k, v]) => `"${k}":${v}`).join(",")}}`;
      const loaded = await host.load({ kind: "bundle", code: definition(actions.replace(/\$/g, "$$$$")), provenance: "untrusted" });
      const row = await store.insert("run", { out: "" });
      const caps = new FakeCapabilities({ sockets: slowSockets() });
      await expect(loaded.callAction("run", "spin", { ...row } as never, host.makeCtx(loaded, { store, caps, ui, nav } as MakeCtxBase))).rejects.toThrow();
      loaded.dispose();
    }, 30_000);
  }
});
