// The JS half of the Android app's ws:// to the local network (docs/28 §6): the plugin's events
// become a PlatformSocket's, a refusal keeps its code, and only a ws:// local address goes to the
// plugin at all — wss:// and everything else stay the WebView's own WebSocket.

import { describe, expect, it } from "vitest";
import { createWebSockets, type PlatformCloseWhy } from "@potyro/capabilities";
import { localOpenerOver, type LocalSocketPlugin } from "../src/local-sockets.js";

type Listener = (e: never) => void;

function fakePlugin(o: { refuse?: string; early?: boolean } = {}) {
  const listeners: Record<string, Listener[]> = { message: [], close: [] };
  const sent: unknown[] = [];
  const closed: unknown[] = [];
  const emit = (event: "message" | "close", e: unknown) => listeners[event]!.forEach((l) => l(e as never));
  const plugin: LocalSocketPlugin = {
    async open({ url }) {
      if (o.refuse) throw Object.assign(new Error(`no: ${url}`), { code: o.refuse });
      // The reader thread can speak before the open's answer arrives.
      if (o.early) emit("message", { id: "s1", text: "hello early" });
      return { id: "s1", protocol: "" };
    },
    async send(m) {
      sent.push(m);
    },
    async close(m) {
      closed.push(m);
      emit("close", { id: m.id, code: m.code ?? 1000, reason: m.reason ?? "", clean: true });
    },
    addListener(event: "message" | "close", fn: Listener) {
      listeners[event]!.push(fn);
      return { remove: () => {} };
    },
  } as unknown as LocalSocketPlugin;
  return { plugin, emit, sent, closed };
}

const collect = () => {
  const got: Array<string | Uint8Array> = [];
  const closes: Array<{ code: number; why: PlatformCloseWhy }> = [];
  return { got, closes, events: { message: (d: string | Uint8Array) => got.push(d), close: (code: number, _r: string, why: PlatformCloseWhy) => closes.push({ code, why }) } };
};

describe("localOpenerOver", () => {
  it("carries text and bytes both ways, and what came before the open's answer", async () => {
    const f = fakePlugin({ early: true });
    const c = collect();
    const s = await localOpenerOver(f.plugin)("ws://192.168.1.20:8123/api/websocket", {}, c.events);
    f.emit("message", { id: "s1", base64: "AQL/" });
    expect(c.got).toEqual(["hello early", new Uint8Array([1, 2, 255])]);
    s.send("ping");
    s.send(new Uint8Array([7, 8]));
    await Promise.resolve();
    expect(f.sent).toEqual([{ id: "s1", text: "ping" }, { id: "s1", base64: "Bwg=" }]);
    s.close(1000, "bye");
    expect(c.closes).toEqual([{ code: 1000, why: "app" }]);
  });

  it("says network for a drop and server for a clean close it did not ask for", async () => {
    const a = fakePlugin();
    const ca = collect();
    await localOpenerOver(a.plugin)("ws://10.0.0.2/", {}, ca.events);
    a.emit("close", { id: "s1", code: 1006, reason: "", clean: false });
    expect(ca.closes).toEqual([{ code: 1006, why: "network" }]);
    const b = fakePlugin();
    const cb = collect();
    await localOpenerOver(b.plugin)("ws://10.0.0.2/", {}, cb.events);
    b.emit("close", { id: "s1", code: 4000, reason: "bye", clean: true });
    expect(cb.closes).toEqual([{ code: 4000, why: "server" }]);
  });

  it("keeps the plugin's refusal code", async () => {
    const f = fakePlugin({ refuse: "insecure" });
    await expect(localOpenerOver(f.plugin)("ws://evil.local/", {}, collect().events)).rejects.toMatchObject({ code: "insecure" });
  });
});

describe("createWebSockets({ local })", () => {
  it("sends only ws:// to a local address to the plugin; wss:// and a public ws:// never reach it", async () => {
    const f = fakePlugin();
    let opened: string[] = [];
    const caps = createWebSockets({
      local: async (url, opts, events) => {
        opened.push(url);
        return localOpenerOver(f.plugin)(url, opts, events);
      },
      WebSocket: class {
        constructor(url: string) {
          opened.push(`browser ${url}`);
          throw new Error("no browser sockets in this test");
        }
      } as never,
      pageProtocol: () => "https:",
      doc: { hidden: false, addEventListener: () => {} },
    });
    const c = collect();
    await caps.open("ws://192.168.1.20:8123/api/websocket", {}, c.events);
    expect(opened).toEqual(["ws://192.168.1.20:8123/api/websocket"]);
    expect(caps.openCount).toBe(1);
    await expect(caps.open("ws://example.com/", {}, collect().events)).rejects.toMatchObject({ code: "insecure" });
    opened = [];
    await expect(caps.open("wss://example.com/", {}, collect().events)).rejects.toMatchObject({ code: "refused" });
    expect(opened).toEqual(["browser wss://example.com/"]);
    // Leaving the app ends the local one too.
    caps.closeAll("left");
    expect(c.closes).toEqual([{ code: 1001, why: "left" }]);
    expect(f.closed).toHaveLength(1);
  });
});
