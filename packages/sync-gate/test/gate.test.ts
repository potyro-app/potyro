import { afterEach, describe, expect, it } from "vitest";
import { CLOSE } from "../src/limits.ts";
import { SYNC_PROTOCOL, TOKEN_PREFIX } from "../src/token.ts";
import { cleanup, fakeRelay, from, gate, open, refusal, until } from "./helpers.ts";

afterEach(cleanup);

const DAY_MS = 24 * 60 * 60 * 1000;

describe("passing a connection through", () => {
  it("carries messages both ways as they are, text and binary, small and far bigger than one read", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay);
    const a = await open(url);
    expect(a.messages).toEqual(['{"type":"ping"}']);

    const big = "x".repeat(700_000);
    a.ws.send('{"action":"load","id":"co_zA"}');
    a.ws.send(big);
    a.ws.send(Buffer.from([0, 1, 2, 255]));
    await until(() => relay.got.length === 3);
    expect(relay.got[0]!.text).toBe('{"action":"load","id":"co_zA"}');
    expect(relay.got[1]!.text).toBe(big);
    expect(relay.got[2]!.bytes).toBe(4);

    relay.sockets[0]!.send("y".repeat(300_000));
    await until(() => a.messages.length === 2);
    expect(a.messages[1]).toBe("y".repeat(300_000));
  });

  it("tells the relay nothing about the client but its key: no address, no subprotocol, no cookie", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay);
    await open(url, { ...from("9.9.9.9"), cookie: "a=b", authorization: "Bearer nope" }, [SYNC_PROTOCOL, `${TOKEN_PREFIX}abc123`]);
    const seen = relay.requests[0]!.headers;
    expect(Object.keys(seen).sort()).toEqual(["connection", "host", "sec-websocket-key", "sec-websocket-version", "upgrade"]);
  });

  it("closes the client with 1001 when the relay behind goes away", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay);
    const a = await open(url);
    relay.sockets[0]!.terminate();
    expect((await a.closed).code).toBe(CLOSE.goingAway);
  });

  it("lets go of a client that leaves without a word, and of its connection to the relay", async () => {
    const relay = await fakeRelay();
    const { url, gate: g } = await gate(relay, { limits: { connectionsPerAddress: 1 } });
    const a = await open(url, from("9.9.9.9"));
    a.ws.terminate(); // no close frame: a phone that lost its network, a tab that was killed
    await until(() => g.stats().connections === 0);
    await until(() => relay.sockets[0]!.readyState === 3);
    await open(url, from("9.9.9.9")); // its place is free again
  });

  it("answers 503 with Retry-After when the relay is not there, and counts it", async () => {
    const relay = await fakeRelay();
    const { url, gate: g } = await gate({ port: relay.port });
    await new Promise<void>((r) => relay.wss.close(() => r()));
    const r = await refusal(url);
    expect(r.status).toBe(503);
    expect(r.retryAfter).toBe("5");
    expect(g.stats().refused["relay-down"]).toBe(1);
  });

  it("answers plain HTTP: health, and 426 for anything else", async () => {
    const relay = await fakeRelay();
    const { port } = await gate(relay);
    const health = await fetch(`http://127.0.0.1:${port}/sync/health`);
    expect(await health.json()).toEqual({ ok: true, connections: 0 });
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(426);
  });
});

describe("whose connection it is", () => {
  it("counts a forged X-Forwarded-For against the real client address: the last entry, which the proxy wrote", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay, { limits: { connectionsPerAddress: 1 } });
    // What Caddy passes on when a client sent its own header through a trusted hop: the client's
    // text first, the peer Caddy saw last. A new forged address each time does not get a new count.
    await open(url, from("6.6.6.6, 9.9.9.9"));
    expect((await refusal(url, from("7.7.7.7, 9.9.9.9"))).status).toBe(429);
    expect((await refusal(url, from("9.9.9.9"))).status).toBe(429);
    // Another real address is not held back by it, whatever it claims to be.
    await open(url, from("9.9.9.9, 8.8.8.8"));
  });

  it("believes no header with TRUST_PROXY=none: the socket's own peer is the address", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay, { trustProxy: "none", limits: { connectionsPerAddress: 1 } });
    await open(url, from("1.1.1.1"));
    expect((await refusal(url, from("2.2.2.2"))).status).toBe(429);
  });

  it("counts an IPv6 address as its /64", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay, { limits: { connectionsPerAddress: 1 } });
    await open(url, from("2001:db8:1:2::1"));
    expect((await refusal(url, from("2001:db8:1:2:ffff::9"))).status).toBe(429);
    await open(url, from("2001:db8:1:3::1"));
  });

  it("refuses a browser from another site when origins are listed, and lets a request with no Origin through", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay, { origins: ["https://potyro.app"] });
    expect((await refusal(url, { origin: "https://elsewhere.example" })).status).toBe(403);
    await open(url, { origin: "https://potyro.app" });
    await open(url);
  });
});

describe("limits per address", () => {
  it("refuses a connection past connectionsPerAddress with 429 and Retry-After, and takes the next once one has gone", async () => {
    const relay = await fakeRelay();
    const { url, gate: g } = await gate(relay, { limits: { connectionsPerAddress: 2 } });
    const a = await open(url, from("9.9.9.9"));
    await open(url, from("9.9.9.9"));
    const r = await refusal(url, from("9.9.9.9"));
    expect(r).toEqual({ status: 429, retryAfter: "30" });
    expect(relay.requests.length).toBe(2); // the relay was never dialled for the third
    a.ws.close();
    await until(() => g.stats().connections === 1);
    await open(url, from("9.9.9.9"));
    expect(g.stats().refused["too-many-connections"]).toBe(1);
  });

  it("refuses new connections past the rate with 429, however few are open", async () => {
    const relay = await fakeRelay();
    let t = 1_000_000;
    const { url } = await gate(relay, { now: () => t, limits: { connectsPerSecond: 1, connectBurst: 2 } });
    for (let i = 0; i < 2; i++) (await open(url, from("9.9.9.9"))).ws.close();
    const r = await refusal(url, from("9.9.9.9"));
    expect(r).toEqual({ status: 429, retryAfter: "1" });
    await open(url, from("8.8.8.8"));
    t += 1000;
    await open(url, from("9.9.9.9"));
  });

  it("slows an address past its bytes a second instead of closing it: everything arrives, later", async () => {
    const relay = await fakeRelay();
    const { url, gate: g } = await gate(relay, { limits: { bytesPerSecond: 400_000, byteBurst: 100_000 } });
    const a = await open(url, from("9.9.9.9"));
    const started = Date.now();
    for (let i = 0; i < 10; i++) a.ws.send("z".repeat(60_000));
    await until(() => relay.got.length === 10, 6000);
    // 600 kB against a burst of 100 kB at 400 kB a second: about a second and a quarter if the gate
    // held it exactly; it passes on what each read brought (64 KiB at most) before holding.
    expect(relay.got[9]!.at - started).toBeGreaterThan(800);
    expect(relay.got.every((m) => m.bytes === 60_000)).toBe(true);
    expect(a.ws.readyState).toBe(1);
    expect(g.stats().heldMs).toBeGreaterThan(800);
    expect(g.stats().closed).toEqual({});
  });

  it("holds every connection of an address to the same bytes a second, and no other address", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay, { limits: { bytesPerSecond: 50_000, byteBurst: 10_000 } });
    const a = await open(url, from("9.9.9.9"));
    const b = await open(url, from("9.9.9.9"));
    const other = await open(url, from("8.8.8.8"));
    const started = Date.now();
    a.ws.send("a".repeat(60_000)); // the address now owes about a second
    await until(() => relay.got.length === 1);
    b.ws.send("b1"); // another connection of the same address: passed on, and then held for what is owed
    await until(() => relay.got.length === 2);
    b.ws.send("b2");
    other.ws.send("other");
    await until(() => relay.got.some((m) => m.text === "other"));
    expect(relay.got.find((m) => m.text === "other")!.at - started).toBeLessThan(500);
    await until(() => relay.got.some((m) => m.text === "b2"), 5000);
    expect(relay.got.find((m) => m.text === "b2")!.at - started).toBeGreaterThan(700);
  });

  it("slows an address past its frames a second", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay, { limits: { framesPerSecond: 50, frameBurst: 10 } });
    const a = await open(url, from("9.9.9.9"));
    const started = Date.now();
    for (let i = 0; i < 60; i++) a.ws.send("m");
    await new Promise((r) => setTimeout(r, 50));
    a.ws.send("last");
    await until(() => relay.got.some((m) => m.text === "last"), 5000);
    expect(relay.got.length).toBe(61);
    expect(relay.got[60]!.at - started).toBeGreaterThan(700);
  });

  it("closes an address with 4021 when its bytes for the day are reached, refuses it until midnight UTC, and lets it back the next day", async () => {
    const relay = await fakeRelay();
    let t = 10 * DAY_MS + 23 * 60 * 60 * 1000; // an hour before midnight UTC
    const { url, gate: g } = await gate(relay, { now: () => t, limits: { bytesPerAddressDay: 50_000 } });
    const a = await open(url, from("9.9.9.9"));
    const second = await open(url, from("9.9.9.9"));
    const other = await open(url, from("8.8.8.8"));
    a.ws.send("q".repeat(60_000));
    expect(await a.closed).toEqual({ code: CLOSE.overToday, reason: "too much from this address today" });
    expect((await second.closed).code).toBe(CLOSE.overToday);
    expect(await refusal(url, from("9.9.9.9"))).toEqual({ status: 429, retryAfter: "3600" });
    expect(other.ws.readyState).toBe(1);
    expect(g.stats().closed[CLOSE.overToday]).toBe(2);
    t += 60 * 60 * 1000;
    await open(url, from("9.9.9.9"));
  });

  it("closes a connection with 1009 at the header of a message longer than the limit, before its bytes are passed on", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay, { limits: { messageBytes: 100_000 } });
    const a = await open(url, from("9.9.9.9"));
    a.ws.send("ok");
    await until(() => relay.got.length === 1);
    a.ws.send("w".repeat(100_001));
    expect((await a.closed).code).toBe(CLOSE.tooBig);
    await new Promise((r) => setTimeout(r, 50));
    expect(relay.got.map((m) => m.text)).toEqual(["ok"]);
    expect(relay.sockets[0]!.readyState).toBe(3); // the relay's side is let go of too
  });
});

describe("limits for the whole relay", () => {
  it("closes everyone with 4022 when the day's bytes are reached, answers 503 until midnight UTC, and says so once in the log", async () => {
    const relay = await fakeRelay();
    const lines: string[] = [];
    const t = 10 * DAY_MS + 22 * 60 * 60 * 1000;
    const { url } = await gate(relay, { now: () => t, log: (l) => lines.push(l), limits: { bytesPerDay: 30_000 } });
    const a = await open(url, from("9.9.9.9"));
    const b = await open(url, from("8.8.8.8"));
    a.ws.send("q".repeat(20_000));
    b.ws.send("q".repeat(20_000));
    expect((await a.closed).code).toBe(CLOSE.relayFull);
    expect((await b.closed).code).toBe(CLOSE.relayFull);
    expect(await refusal(url, from("7.7.7.7"))).toEqual({ status: 503, retryAfter: "7200" });
    await refusal(url, from("7.7.7.7"));
    expect(lines.filter((l) => l.includes("closed until midnight UTC")).length).toBe(1);
  });

  it("closes sync while the relay's disk is under the floor, and opens again when there is room", async () => {
    const relay = await fakeRelay();
    let free = 5_000;
    const { url } = await gate(relay, { freeBytes: async () => free, diskCheckMs: 20, limits: { minFreeBytes: 1_000 } });
    const a = await open(url);
    free = 500;
    expect((await a.closed).code).toBe(CLOSE.relayFull);
    expect(await refusal(url)).toEqual({ status: 503, retryAfter: "600" });
    free = 5_000;
    await new Promise((r) => setTimeout(r, 80));
    await open(url);
  });

  it("does not close sync when the free disk cannot be read", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay, {
      freeBytes: async () => {
        throw new Error("no such path");
      },
      diskCheckMs: 20,
    });
    await new Promise((r) => setTimeout(r, 60));
    await open(url);
  });

  it("answers 503 past the gate's own number of connections", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay, { limits: { connections: 1 } });
    await open(url, from("9.9.9.9"));
    expect(await refusal(url, from("8.8.8.8"))).toEqual({ status: 503, retryAfter: "30" });
  });
});

describe("the limiter's own memory", () => {
  it("counts at most `addresses` addresses: the oldest one with no connection is forgotten, and one in use never is", async () => {
    const relay = await fakeRelay();
    const { url, gate: g } = await gate(relay, { limits: { addresses: 2, connectBurst: 5, connectsPerSecond: 0.001 } });
    const held = await open(url, from("1.1.1.1"));
    (await open(url, from("2.2.2.2"))).ws.close();
    await until(() => g.stats().connections === 1);
    // A third address: 2.2.2.2 (no connection) is let go; 1.1.1.1 (connected) is kept.
    (await open(url, from("3.3.3.3"))).ws.close();
    await until(() => g.stats().connections === 1);
    expect(g.stats().addresses).toBe(2);
    expect(held.ws.readyState).toBe(1);
    // With every counted address connected, a new one is refused rather than a count thrown away.
    await open(url, from("3.3.3.3"));
    expect((await refusal(url, from("4.4.4.4"))).status).toBe(503);
    expect(g.stats().addresses).toBe(2);
  });

  it("finds an address to forget however many connected ones were counted before it", async () => {
    const relay = await fakeRelay();
    const { url, gate: g } = await gate(relay, { limits: { addresses: 301, connectBurst: 5 } });
    for (let i = 0; i < 300; i++) await open(url, from(`10.0.${i >> 8}.${i & 255}`)); // all stay connected
    (await open(url, from("2.2.2.2"))).ws.close();
    await until(() => g.stats().connections === 300);
    await open(url, from("3.3.3.3")); // 2.2.2.2 is the one let go, not a refusal
    expect(g.stats().refused).toEqual({});
    expect(g.stats().addresses).toBe(301);
  }, 20_000);

  it("gives a refused connection's place back even when the client never closes its side", async () => {
    const relay = await fakeRelay();
    const { port, gate: g } = await gate(relay, { limits: { connections: 2 }, tokenGate: () => false });
    const { connect: tcp } = await import("node:net");
    const lingering = [0, 1, 2].map(() => {
      const s = tcp({ port, host: "127.0.0.1", allowHalfOpen: true });
      s.on("error", () => {});
      s.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
      return s;
    });
    await until(() => (g.stats().refused.token ?? 0) === 3);
    expect(g.stats().refused.busy).toBeUndefined(); // the third was not turned away for the first two
    await until(() => lingering.every((s) => s.destroyed || s.readableEnded), 3000).catch(() => {});
    for (const s of lingering) s.destroy();
  });

  it("forgets an address once it has no connection and the day it sent something in is over", async () => {
    const relay = await fakeRelay();
    let t = 5_000_000;
    const { url, gate: g } = await gate(relay, { now: () => t, sweepMs: 20 });
    const a = await open(url, from("9.9.9.9"));
    a.ws.close();
    await until(() => g.stats().connections === 0);
    await new Promise((r) => setTimeout(r, 60));
    expect(g.stats().addresses).toBe(1); // what it sent today is remembered until the day ends
    t += DAY_MS;
    await until(() => g.stats().addresses === 0);
  });

  it("never holds a message: a sender that is being slowed is not read, so nothing of it piles up in the gate", async () => {
    const relay = await fakeRelay();
    const { url, gate: g } = await gate(relay, { limits: { bytesPerSecond: 1_000, byteBurst: 1_000 } });
    const a = await open(url, from("9.9.9.9"));
    a.ws.send(Buffer.alloc(4_000_000));
    await new Promise((r) => setTimeout(r, 400));
    // Far less than the message has passed the gate; the rest waits in the sender, held by TCP.
    expect(g.stats().bytesUp).toBeLessThan(1_500_000);
    expect(a.ws.bufferedAmount).toBeGreaterThan(1_000_000);
  });
});

describe("what it writes down", () => {
  it("logs totals only: no address, and no line for a single refusal", async () => {
    const relay = await fakeRelay();
    const lines: string[] = [];
    const { url, gate: g } = await gate(relay, { log: (l) => lines.push(l), limits: { connectionsPerAddress: 1 } });
    await open(url, from("203.0.113.77"));
    for (let i = 0; i < 5; i++) await refusal(url, from("203.0.113.77"));
    expect(lines).toEqual([]);
    await g.close();
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('"too-many-connections":5');
    expect(lines.join("\n")).not.toContain("203.0.113");
  });
});
