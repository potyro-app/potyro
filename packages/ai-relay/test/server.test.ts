import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openRouter, startServer } from "../src/server.ts";
import type { RelayRequest } from "../src/relay.ts";
import { OPENROUTER_URL } from "../src/request.ts";

let server: Server | null = null;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

describe("the AI relay's HTTP side", () => {
  it("passes the request through, with the proxy's prefix taken off and the forwarded address", async () => {
    const seen: RelayRequest[] = [];
    server = await startServer({ handle: async (r) => (seen.push(r), { status: 200, body: { ok: true } }), port: 0, host: "127.0.0.1" });
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/ai/complete`, { method: "POST", body: "{}", headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } });
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
