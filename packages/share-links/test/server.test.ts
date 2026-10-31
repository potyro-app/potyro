import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { GENERAL_CONTACT, readAbuseContact, readLimits, startServer } from "../src/server.ts";
import { createShareHandler, type ShareRequest } from "../src/handler.ts";
import { clientAddress, readTrustProxy } from "../src/address.ts";
import { memoryShareStore } from "../src/store.ts";
import { toBase64 } from "../src/wire.ts";

let server: Server | null = null;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

const portOf = (s: Server) => (s.address() as AddressInfo).port;
const upload = JSON.stringify({ meta: { title: "Groceries", description: "", lang: "en" }, payload: toBase64(new Uint8Array([1, 2, 3])) });

describe("the share service's HTTP side", () => {
  it("passes on the address the proxy wrote, not one the client sent (#348)", async () => {
    const seen: ShareRequest[] = [];
    server = await startServer({
      handle: async (r) => (seen.push(r), { status: 200, headers: { "content-type": "application/json" }, body: "{}" }),
      port: 0,
      host: "127.0.0.1",
    });
    // A client wrote its own X-Forwarded-For; the proxy put the real peer after it.
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/s/abc`, { headers: { "x-forwarded-for": "6.6.6.6, 9.9.9.9" } });
    expect(res.status).toBe(200);
    expect(seen[0]!.ip).toBe("9.9.9.9");
  });

  it("does not let a forged X-Forwarded-For move the per-address limit off the real client (#119)", async () => {
    const handle = createShareHandler({ store: memoryShareStore(), indexHtml: async () => "<html></html>", limits: { createsPerDay: 2 } });
    server = await startServer({ handle, port: 0, host: "127.0.0.1", trustProxy: "caddy" });
    // What Caddy passes on when a client sent its own X-Forwarded-For through a trusted hop: the
    // client's entries first, then the peer. The real client is 9.9.9.9 every time.
    const send = (forged: string) =>
      fetch(`http://127.0.0.1:${portOf(server!)}/share-api/shares`, { method: "POST", body: upload, headers: { "x-forwarded-for": `${forged}, 9.9.9.9` } });
    expect((await send("1.1.1.1")).status).toBe(201);
    expect((await send("2.2.2.2")).status).toBe(201);
    const third = await send("3.3.3.3");
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ ok: false, code: "too-many-links" });
  });

  it("with TRUST_PROXY=none, the header is the client's own words and is ignored", async () => {
    const handle = createShareHandler({ store: memoryShareStore(), indexHtml: async () => "<html></html>", limits: { createsPerDay: 1 } });
    server = await startServer({ handle, port: 0, host: "127.0.0.1", trustProxy: "none" });
    const send = (forged: string) => fetch(`http://127.0.0.1:${portOf(server!)}/share-api/shares`, { method: "POST", body: upload, headers: { "x-forwarded-for": forged } });
    expect((await send("1.1.1.1")).status).toBe(201);
    // A new "address" in the header changes nothing: the socket's peer is the same.
    expect((await send("2.2.2.2")).status).toBe(429);
  });
});

describe("whose address it is, and the limits from the environment", () => {
  it("believes only the entry Caddy wrote: the last", () => {
    expect(clientAddress("9.9.9.9", "127.0.0.1", "caddy")).toBe("9.9.9.9");
    expect(clientAddress("6.6.6.6, 9.9.9.9", "127.0.0.1", "caddy")).toBe("9.9.9.9");
    expect(clientAddress(["6.6.6.6", "9.9.9.9"], "127.0.0.1", "caddy")).toBe("9.9.9.9");
    expect(clientAddress(undefined, "127.0.0.1", "caddy")).toBe("127.0.0.1");
    expect(clientAddress("6.6.6.6", "203.0.113.7", "none")).toBe("203.0.113.7");
    expect(readTrustProxy(undefined)).toBe("caddy");
    expect(() => readTrustProxy("apache")).toThrow(/TRUST_PROXY/);
  });

  it("reads the per-address limits, and refuses a value that is not a count", () => {
    expect(readLimits({})).toEqual({});
    expect(readLimits({ SHARE_CREATE_PER_ADDRESS_DAY: "5", SHARE_PAYLOAD_PER_ADDRESS_DAY: "50", SHARE_PAGE_PER_ADDRESS_DAY: "500" })).toEqual({
      createsPerDay: 5,
      payloadsPerDay: 50,
      pagesPerDay: 500,
    });
    expect(() => readLimits({ SHARE_PAGE_PER_ADDRESS_DAY: "lots" })).toThrow(/SHARE_PAGE_PER_ADDRESS_DAY/);
    expect(() => readLimits({ SHARE_CREATE_PER_ADDRESS_DAY: "0" })).toThrow(/above 0/);
    expect(readLimits({ SHARE_STORED_BYTES_DAY: "1000", SHARE_MIN_FREE_BYTES: "50" })).toEqual({ storedBytesPerDay: 1000, minFreeBytes: 50 });
  });

  it("never names a placeholder as the report address: it says so, and names the general one", () => {
    const said: string[] = [];
    const warn = (m: string) => said.push(m);
    expect(readAbuseContact("<ABUSE EMAIL>", warn)).toBe(GENERAL_CONTACT);
    expect(said.join()).toMatch(/placeholder <ABUSE EMAIL>/);
    expect(readAbuseContact(" <anything> ", warn)).toBe(GENERAL_CONTACT);
    expect(readAbuseContact(undefined, warn)).toBe("contact@potyro.com");
    expect(readAbuseContact("", warn)).toBe("contact@potyro.com");
    expect(said).toHaveLength(2);
    expect(readAbuseContact("abuse@potyro.app", warn)).toBe("abuse@potyro.app");
  });
});
