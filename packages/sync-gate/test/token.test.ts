// The token gate (#11, item 5): nothing is checked today. These tests fix where a token travels and
// where the check sits, so a plan's gate is a function, not a change to the proxy.
import { afterEach, describe, expect, it } from "vitest";
import { openGate, readOffer, SYNC_PROTOCOL, TOKEN_PREFIX } from "../src/token.ts";
import { cleanup, fakeRelay, from, gate, open, refusal } from "./helpers.ts";

afterEach(cleanup);

describe("what a client offers", () => {
  it("reads the token from the subprotocols, and nothing that is not one", () => {
    expect(readOffer(undefined)).toEqual({ named: false, token: null });
    expect(readOffer(`${SYNC_PROTOCOL}, ${TOKEN_PREFIX}abc-123_X`)).toEqual({ named: true, token: "abc-123_X" });
    expect(readOffer(`${TOKEN_PREFIX}has space`)).toEqual({ named: false, token: null });
    expect(readOffer(`${TOKEN_PREFIX}${"a".repeat(513)}`).token).toBeNull();
    expect(readOffer([SYNC_PROTOCOL, `${TOKEN_PREFIX}t`])).toEqual({ named: true, token: "t" });
  });
});

describe("today: no gate", () => {
  it("lets everyone through, with a token or without", () => {
    expect(openGate({ token: null, address: "9.9.9.9" })).toBe(true);
    expect(openGate({ token: "anything", address: "9.9.9.9" })).toBe(true);
  });

  it("connects a client that offers nothing, as the shell does today", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay);
    const a = await open(url);
    expect(a.ws.protocol).toBe("");
  });

  it("answers a client that offers the subprotocol and a token with the subprotocol alone", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay);
    const a = await open(url, {}, [SYNC_PROTOCOL, `${TOKEN_PREFIX}s3cret`]);
    expect(a.ws.protocol).toBe(SYNC_PROTOCOL);
  });
});

// Node 22 has a WebSocket of its own that follows the browsers' standard (undici), handshake rules
// included; `ws`, used everywhere else here, is more forgiving. Node 20 has none.
const Standard = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;

describe.skipIf(typeof Standard !== "function")("a standard WebSocket, as in a browser", () => {
  const outcome = (url: string, protocols?: string[]): Promise<{ opened: boolean; protocol: string }> =>
    new Promise((resolve) => {
      const ws = new Standard!(url, protocols);
      ws.onmessage = () => {
        resolve({ opened: true, protocol: ws.protocol });
        ws.close();
      };
      ws.onerror = () => resolve({ opened: false, protocol: "" });
    });

  it("connects through the gate offering nothing, and offering the subprotocol with a token", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay);
    expect(await outcome(url)).toEqual({ opened: true, protocol: "" });
    expect(await outcome(url, [SYNC_PROTOCOL, `${TOKEN_PREFIX}s3cret`])).toEqual({ opened: true, protocol: SYNC_PROTOCOL });
  });

  it("drops a connection whose only offer is the token: the reason a client offers the named subprotocol too", async () => {
    const relay = await fakeRelay();
    const { url } = await gate(relay);
    // The gate never answers with the token, and a standard client that offered subprotocols and
    // got none back ends the connection itself.
    expect((await outcome(url, [`${TOKEN_PREFIX}s3cret`])).opened).toBe(false);
  });
});

describe("where the check sits", () => {
  it("asks once per connection, with the token and the real address, before the relay is dialled", async () => {
    const relay = await fakeRelay();
    const asked: Array<{ token: string | null; address: string; dialled: number }> = [];
    const { url } = await gate(relay, { tokenGate: (ask) => (asked.push({ ...ask, dialled: relay.requests.length }), true) });
    await open(url, from("6.6.6.6, 9.9.9.9"), [SYNC_PROTOCOL, `${TOKEN_PREFIX}s3cret`]);
    await open(url, from("2001:db8:1:2::7"));
    expect(asked).toEqual([
      { token: "s3cret", address: "9.9.9.9", dialled: 0 },
      { token: null, address: "2001:db8:1:2::/64", dialled: 1 },
    ]);
  });

  it("refuses with 401 when the gate says no, and the relay never hears of it", async () => {
    const relay = await fakeRelay();
    const { url, gate: g } = await gate(relay, { tokenGate: async ({ token }) => token === "paid" });
    expect((await refusal(url, {}, [SYNC_PROTOCOL, `${TOKEN_PREFIX}wrong`])).status).toBe(401);
    expect((await refusal(url)).status).toBe(401);
    expect(relay.requests.length).toBe(0);
    await open(url, {}, [SYNC_PROTOCOL, `${TOKEN_PREFIX}paid`]);
    expect(g.stats().refused.token).toBe(2);
    expect(g.stats().connections).toBe(1);
  });

  it("refuses when the check itself fails, and gives the connection's place back", async () => {
    const relay = await fakeRelay();
    const { url, gate: g } = await gate(relay, {
      limits: { connectionsPerAddress: 1 },
      tokenGate: () => {
        throw new Error("the token service is down");
      },
    });
    expect((await refusal(url, from("9.9.9.9"))).status).toBe(401);
    expect((await refusal(url, from("9.9.9.9"))).status).toBe(401); // not 429: the first one's place was given back
    expect(g.stats().connections).toBe(0);
  });

  it("takes a check that never answers as a no, after the time the relay itself is given", async () => {
    const relay = await fakeRelay();
    const { url, gate: g } = await gate(relay, { limits: { dialMs: 100 }, tokenGate: () => new Promise<boolean>(() => {}) });
    expect((await refusal(url)).status).toBe(401);
    expect(g.stats().connections).toBe(0);
    expect(relay.requests.length).toBe(0);
  });

  it("never spends a token check on an address that is over its limits", async () => {
    const relay = await fakeRelay();
    let asked = 0;
    const { url } = await gate(relay, { limits: { connectionsPerAddress: 1 }, tokenGate: () => (asked++, true) });
    await open(url, from("9.9.9.9"));
    expect((await refusal(url, from("9.9.9.9"))).status).toBe(429);
    expect(asked).toBe(1);
  });
});
