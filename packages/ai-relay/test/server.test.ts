import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { killSwitch, openRouter, openRouterChat, startServer } from "../src/server.ts";
import { clientAddress, readTrustProxy } from "../src/address.ts";
import { createAiRelay, type RelayRequest } from "../src/relay.ts";
import { createChatProxy } from "../src/chat.ts";
import { memoryLedger } from "../src/ledger.ts";
import { AI_FORMAT, OPENROUTER_URL } from "../src/request.ts";

let server: Server | null = null;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

describe("the AI relay's HTTP side", () => {
  it("passes the request through, with the proxy's prefix taken off and the address the proxy appended, not one the client sent (#348)", async () => {
    const seen: RelayRequest[] = [];
    server = await startServer({ handle: async (r) => (seen.push(r), { status: 200, body: { ok: true } }), port: 0, host: "127.0.0.1" });
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ai/complete`, { method: "POST", body: "{}", headers: { "x-forwarded-for": "6.6.6.6, 9.9.9.9" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(seen[0]).toMatchObject({ method: "POST", path: "/complete", body: "{}", ip: "9.9.9.9" });
  });

  it("stops reading a body that is too big", async () => {
    let called = false;
    server = await startServer({ handle: async () => ((called = true), { status: 200, body: {} }), port: 0, host: "127.0.0.1" });
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/complete`, { method: "POST", body: "x".repeat(7 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(called).toBe(false);
  });
});

describe("the OpenRouter client", () => {
  it("posts the body with Potyro's key to OpenRouter and reads the answer", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { cost: 0.0001 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const reply = await openRouter("sk-or-test", fake)({ model: "m" });
    expect(reply).toEqual({ ok: true, text: "ok", cost: 0.0001 });
    expect(calls[0]!.url).toBe(OPENROUTER_URL);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
  });
});

describe("whose address it is (TRUST_PROXY)", () => {
  it("behind Caddy, believes only the entry Caddy wrote: the last", () => {
    // Caddy, with no trusted_proxies, replaces whatever the client sent with the peer it saw…
    expect(clientAddress("9.9.9.9", "127.0.0.1", "caddy")).toBe("9.9.9.9");
    // …and with trusted_proxies, appends that peer: still last. A forged entry is never last.
    expect(clientAddress("6.6.6.6, 9.9.9.9", "127.0.0.1", "caddy")).toBe("9.9.9.9");
    expect(clientAddress(undefined, "127.0.0.1", "caddy")).toBe("127.0.0.1");
    // With no proxy, the header is the client's own words and is ignored.
    expect(clientAddress("6.6.6.6", "203.0.113.7", "none")).toBe("203.0.113.7");
  });

  it("is caddy unless told otherwise, and refuses a value it does not know", () => {
    expect(readTrustProxy(undefined)).toBe("caddy");
    expect(readTrustProxy("none")).toBe("none");
    expect(() => readTrustProxy("apache")).toThrow(/TRUST_PROXY/);
  });

  it("does not let a forged X-Forwarded-For move the per-address limit off the real client", async () => {
    const relay = createAiRelay({ upstream: async () => ({ ok: true, text: "x", cost: 0 }), now: Date.now, limits: { perAddressDay: 2, perDeviceDay: 100 } });
    server = await startServer({ handle: relay.handle, port: 0, host: "127.0.0.1", trustProxy: "caddy" });
    const { port } = server.address() as AddressInfo;
    const send = (device: string, forged: string) =>
      fetch(`http://127.0.0.1:${port}/ai/complete`, {
        method: "POST",
        // What Caddy passes on when a client sent its own X-Forwarded-For through a trusted hop: the
        // client's entries first, then the peer. The real client is 9.9.9.9 every time.
        headers: { "x-forwarded-for": `${forged}, 9.9.9.9` },
        body: JSON.stringify({ format: AI_FORMAT, device, system: "s", parts: [{ type: "text", text: "t" }], maxTokens: 10 }),
      });
    expect((await send("device-a-0001", "1.1.1.1")).status).toBe(200);
    expect((await send("device-b-0001", "2.2.2.2")).status).toBe(200);
    const third = await send("device-c-0001", "3.3.3.3");
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ reason: "address-day" });
  });
});

describe("the chat route over HTTP", () => {
  const body = JSON.stringify({ model: "deepseek/deepseek-v4-flash-0731", messages: [{ role: "user", content: "hi" }], stream: true });
  const headers = { authorization: "Bearer potyro-device:device-0001", "content-type": "application/json" };

  it("pipes OpenRouter's answer as it comes: a keep-alive line reaches the client before the answer ends", async () => {
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const upstreamBody = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
    const ledger = memoryLedger();
    const chat = createChatProxy({ upstream: async () => new Response(upstreamBody, { headers: { "content-type": "text/event-stream" } }), now: Date.now, ledger });
    server = await startServer({ handle: async () => ({ status: 404, body: {} }), chat: chat.handle, port: 0, host: "127.0.0.1" });
    const { port } = server.address() as AddressInfo;
    const enc = new TextEncoder();
    ctl.enqueue(enc.encode(": OPENROUTER PROCESSING\n\n"));
    const res = await fetch(`http://127.0.0.1:${port}/ai/v1/chat/completions`, { method: "POST", headers, body });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("x-potyro-left-usd")).toBe("0.5");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    expect(dec.decode((await reader.read()).value)).toBe(": OPENROUTER PROCESSING\n\n");
    ctl.enqueue(enc.encode('data: {"choices":[],"usage":{"cost":0.002}}\n\ndata: [DONE]\n\n'));
    ctl.close();
    let rest = "";
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest += dec.decode(r.value);
    expect(rest).toContain("[DONE]");
    expect(ledger.spent(new Date().toISOString().slice(0, 7))).toBeCloseTo(0.002);
  });

  it("answers the native apps' WebViews with CORS, and no other site", async () => {
    const chat = createChatProxy({ upstream: async () => new Response("{}"), now: Date.now, isOff: () => true });
    server = await startServer({ handle: async () => ({ status: 404, body: {} }), chat: chat.handle, port: 0, host: "127.0.0.1" });
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/ai/v1/chat/completions`;
    const pre = await fetch(url, { method: "OPTIONS", headers: { origin: "capacitor://localhost", "access-control-request-method": "POST" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(pre.headers.get("access-control-allow-credentials")).toBeNull();
    const other = await fetch(url, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    // The kill switch is on here: 503, and the native app may read why.
    const off = await fetch(url, { method: "POST", headers: { ...headers, origin: "https://localhost" }, body });
    expect(off.status).toBe(503);
    expect(off.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(await off.json()).toMatchObject({ error: { code: "off", type: "potyro" } });
  });
});

describe("/health and the chat route (#121)", () => {
  const relay = () => createAiRelay({ upstream: async () => ({ ok: true, text: "", cost: 0 }), now: Date.now });
  const health = async (): Promise<Record<string, unknown>> => {
    const { port } = server!.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ai/health`);
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  };

  it("says chat:false where the relay has no chat route", async () => {
    server = await startServer({ handle: relay().handle, port: 0, host: "127.0.0.1" });
    expect(await health()).toEqual({ ok: true, chat: false });
  });

  it("says chat:true and names the model while the route is on, and chat:false once the kill switch is thrown", async () => {
    let off = false;
    const chat = createChatProxy({ upstream: async () => new Response("{}"), now: Date.now });
    server = await startServer({ handle: relay().handle, chat: chat.handle, chatOff: () => off, chatModel: "deepseek/deepseek-v4-flash-0731", port: 0, host: "127.0.0.1" });
    expect(await health()).toEqual({ ok: true, chat: true, model: "deepseek/deepseek-v4-flash-0731" });
    off = true;
    expect(await health()).toEqual({ ok: true, chat: false });
  });

  it("lets a native WebView send the headers the Studio's client sends", async () => {
    const chat = createChatProxy({ upstream: async () => new Response("{}"), now: Date.now });
    server = await startServer({ handle: relay().handle, chat: chat.handle, port: 0, host: "127.0.0.1" });
    const { port } = server.address() as AddressInfo;
    const pre = await fetch(`http://127.0.0.1:${port}/ai/v1/chat/completions`, { method: "OPTIONS", headers: { origin: "https://localhost", "access-control-request-method": "POST" } });
    expect(pre.headers.get("access-control-allow-headers")).toMatch(/http-referer.*x-title/);
  });
});

describe("the kill switch", () => {
  it("is on with AI_CHAT_OFF=1, or while the file AI_CHAT_OFF_FILE names is there, asked each time", () => {
    let there = false;
    expect(killSwitch({ AI_CHAT_OFF: "1" })()).toBe(true);
    expect(killSwitch({})()).toBe(false);
    const off = killSwitch({ AI_CHAT_OFF_FILE: "/run/potyro-ai/off" }, (p) => p === "/run/potyro-ai/off" && there);
    expect(off()).toBe(false);
    there = true;
    expect(off()).toBe(true);
  });
});

describe("the chat route's OpenRouter client", () => {
  it("posts the body with Potyro's key and hands the answer back unread, with a deadline", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response("streamed"))) as unknown as typeof fetch;
    const res = await openRouterChat("sk-or-test", fake)({ model: "m" });
    expect(await res.text()).toBe("streamed");
    expect(calls[0]!.url).toBe(OPENROUTER_URL);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });
});
