import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startServer } from "../src/server.ts";
import { githubIssues } from "../src/github.ts";
import type { RelayRequest } from "../src/relay.ts";

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
