// The flow control between a sealed app's box and the host's connections (docs/28 §4): the box gets
// events only once it knows the connection, never more than the window untaken, and an app that does
// not keep up is closed "slow" rather than filling the page's memory.

import { describe, expect, it } from "vitest";
import { FakeCapabilities, createFakeSockets } from "@potyro/capabilities";
import type { Ctx } from "potyro";
import { mediateCaps } from "../src/index.js";
import { SocketBridge, WINDOW_EVENTS, type BoxSocketEvent } from "../src/socket-bridge.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await tick(2);
  }
}

function ctxWith(fake: ReturnType<typeof createFakeSockets>): Ctx {
  const caps = mediateCaps({ caps: new FakeCapabilities({ sockets: fake.cap }), provenance: "trusted", permissions: {}, ui: { toast: () => {}, confirm: async () => true, prompt: async () => null, pick: async () => null }, appName: "T", owner: {} });
  return { caps } as unknown as Ctx;
}

describe("SocketBridge", () => {
  it("holds a connection's events until the box has its number", async () => {
    const fake = createFakeSockets();
    fake.serve("push.test", (c) => c.send("early"));
    const got: BoxSocketEvent[] = [];
    const bridge = new SocketBridge((ev) => (got.push(ev), true));
    const info = await bridge.open(ctxWith(fake), "wss://push.test/");
    await tick(10);
    expect(got).toEqual([]);
    bridge.ready(info.sid);
    expect(got).toEqual([{ sid: info.sid, kind: "message", data: "early" }]);
  });

  it(`never has more than ${WINDOW_EVENTS} untaken events in the box; an ack lets more in`, async () => {
    const fake = createFakeSockets();
    fake.serve("many.test", (c) => {
      for (let i = 0; i < WINDOW_EVENTS + 36; i++) c.send(`m${i}`);
    });
    const got: BoxSocketEvent[] = [];
    const bridge = new SocketBridge((ev) => (got.push(ev), false)); // the box holds every one
    const info = await bridge.open(ctxWith(fake), "wss://many.test/");
    bridge.ready(info.sid);
    await until(() => got.length === WINDOW_EVENTS);
    await tick(20);
    expect(got).toHaveLength(WINDOW_EVENTS);
    bridge.ack(info.sid, 10, 30);
    expect(got).toHaveLength(WINDOW_EVENTS + 10);
    expect(got.map((e) => (e.kind === "message" ? e.data : "")).slice(0, 3)).toEqual(["m0", "m1", "m2"]);
  });

  it("closes a connection the box does not keep up with, and the close always gets through", async () => {
    const fake = createFakeSockets();
    fake.serve("flood.test", (c) => {
      for (let i = 0; i < 400; i++) c.send(new Uint8Array(8 * 1024));
    });
    const got: BoxSocketEvent[] = [];
    const bridge = new SocketBridge((ev) => (got.push(ev), false));
    const info = await bridge.open(ctxWith(fake), "wss://flood.test/");
    bridge.ready(info.sid);
    await until(() => got.some((e) => e.kind === "close"));
    expect(got.find((e) => e.kind === "close")).toMatchObject({ why: "slow", code: 1008 });
    expect(bridge.size).toBe(0);
  });

  it("ends every connection when the box goes (stopped), and refuses a send to a number it does not hold", async () => {
    const fake = createFakeSockets();
    const got: BoxSocketEvent[] = [];
    const bridge = new SocketBridge((ev) => (got.push(ev), true));
    const info = await bridge.open(ctxWith(fake), "wss://echo.test/");
    bridge.ready(info.sid);
    bridge.endAll("stopped", "the app was stopped");
    await until(() => fake.connections[0]!.closed);
    await expect(bridge.send(info.sid, "x")).rejects.toMatchObject({ code: "closed" });
    await expect(bridge.send(999, "x")).rejects.toMatchObject({ code: "closed" });
  });
});
