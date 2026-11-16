import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startServer } from "../src/server.ts";
import { githubIssues } from "../src/github.ts";
import { createRelay, type RelayRequest } from "../src/relay.ts";
import { addressKey } from "../src/address.ts";
import { REQUEST_FORMAT } from "../src/request.ts";

let server: Server | null = null;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

describe("the relay's HTTP side", () => {
  it("passes the request through, with the proxy's prefix taken off and the address the proxy appended, not one the client sent (#348)", async () => {
    const seen: RelayRequest[] = [];
    server = await startServer({ handle: async (r) => (seen.push(r), { status: 201, body: { ok: true } }), port: 0, host: "127.0.0.1" });
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/requests/platform-requests`, { method: "POST", body: "{}", headers: { "x-forwarded-for": "6.6.6.6, 9.9.9.9" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(seen[0]).toMatchObject({ method: "POST", path: "/platform-requests", body: "{}", ip: "9.9.9.9" });
  });

  it("counts a forged X-Forwarded-For against the real client address: each new forged entry is the same sender", async () => {
    const filed: string[] = [];
    const issues = {
      listOpen: async () => [],
      create: async (i: { title: string }) => (filed.push(i.title), { number: filed.length, title: i.title, url: "u" }),
      comment: async () => {},
    };
    const relay = createRelay({ issues, now: Date.now, limits: { perDevice: 100, perAddress: 2, windowMs: 86_400_000 } });
    server = await startServer({ handle: relay.handle, port: 0, host: "127.0.0.1", trustProxy: "caddy" });
    const { port } = server.address() as AddressInfo;
    const send = (n: number, forwarded: string) =>
      fetch(`http://127.0.0.1:${port}/platform-requests`, {
        method: "POST",
        headers: { "x-forwarded-for": forwarded },
        body: JSON.stringify({ format: REQUEST_FORMAT, id: `id-${n}`, device: `device-${n}`, title: `Reading barcode kind ${n}`, body: "It would help to have it.", language: "en" }),
      });
    // What Caddy passes on when the client sent its own header through a trusted hop: the client's
    // text first, the peer Caddy saw last. A new device id and a new forged address each time.
    expect((await send(1, "6.6.6.1, 9.9.9.9")).status).toBe(201);
    expect((await send(2, "6.6.6.2, 9.9.9.9")).status).toBe(201);
    expect((await send(3, "6.6.6.3, 9.9.9.9")).status).toBe(429);
    // Another real address is not held back, whatever it claims to be.
    expect((await send(4, "9.9.9.9, 8.8.8.8")).status).toBe(201);
  });

  it("believes no header with trustProxy none, and counts an IPv6 address as its /64", async () => {
    const seen: RelayRequest[] = [];
    server = await startServer({ handle: async (r) => (seen.push(r), { status: 201, body: { ok: true } }), port: 0, host: "127.0.0.1", trustProxy: "none" });
    const { port } = server.address() as AddressInfo;
    await fetch(`http://127.0.0.1:${port}/platform-requests`, { method: "POST", body: "{}", headers: { "x-forwarded-for": "6.6.6.6" } });
    expect(seen[0]!.ip).not.toBe("6.6.6.6");
    expect(addressKey("2001:db8:1:2:aaaa::1")).toBe(addressKey("2001:db8:1:2:bbbb::2"));
  });

  it("stops reading a body that is too big", async () => {
    let called = false;
    server = await startServer({ handle: async () => ((called = true), { status: 201, body: {} }), port: 0, host: "127.0.0.1" });
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/platform-requests`, { method: "POST", body: "x".repeat(70_000) });
    expect(res.status).toBe(413);
    expect(called).toBe(false);
  });
});

describe("the GitHub client", () => {
  it("files, lists and comments in the one repository, with the token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.includes("/comments") ? {} : url.includes("?") ? [{ number: 1, title: "t", html_url: "u" }, { number: 2, title: "pr", html_url: "v", pull_request: {} }] : { number: 3, title: "new", html_url: "w" };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const gh = githubIssues({ token: "tok", repo: "potyro-app/potyro", fetch: fake });
    expect(await gh.listOpen("platform-request")).toEqual([{ number: 1, title: "t", url: "u" }]);
    expect(await gh.create({ title: "new", body: "b", labels: ["platform-request"] })).toEqual({ number: 3, title: "new", url: "w" });
    await gh.comment(1, "again");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.github.com/repos/potyro-app/potyro/issues?state=open&labels=platform-request&per_page=100",
      "https://api.github.com/repos/potyro-app/potyro/issues",
      "https://api.github.com/repos/potyro-app/potyro/issues/1/comments",
    ]);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("refuses a repository name that is not one", () => {
    expect(() => githubIssues({ token: "t", repo: "../../x" })).toThrow();
  });

  it("throws on an answer GitHub refused, so the relay says 502", async () => {
    const gh = githubIssues({ token: "t", repo: "a/b", fetch: (async () => new Response("no", { status: 403 })) as unknown as typeof fetch });
    await expect(gh.create({ title: "x", body: "y", labels: [] })).rejects.toThrow(/403/);
  });
});
