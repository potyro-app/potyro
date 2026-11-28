import { describe, expect, it } from "vitest";
import { guardedLookup, isPublicAddress, requestOverHttps, safeUrl } from "../src/net.ts";

describe("which addresses the service may reach", () => {
  it("only addresses on the public internet", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("never this machine, a private network, a link-local or a multicast address", () => {
    const inside = ["127.0.0.1", "10.1.2.3", "172.17.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1"];
    for (const ip of inside) expect(isPublicAddress(ip), ip).toBe(false);
  });

  it("an IPv4 address written as IPv6 is judged as the IPv4 address", () => {
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:7f00:1")).toBe(false);
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });

  it("what is not an address is not public", () => {
    expect(isPublicAddress("localhost")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });
});

describe("which URLs the service asks", () => {
  it("https, the default port, a host name", () => {
    expect(safeUrl("https://social.example/users/ana")?.href).toBe("https://social.example/users/ana");
  });

  it("not http, another port, a bare address, a single-label name, credentials, or nonsense", () => {
    const refused = [
      "http://social.example/users/ana",
      "https://social.example:8443/inbox",
      "https://127.0.0.1/inbox",
      "https://[::1]/inbox",
      "https://localhost/inbox",
      "https://relay/inbox",
      "https://user:pw@social.example/inbox",
      "https://social.example./inbox",
      "file:///etc/passwd",
      "not a url",
      42,
      undefined,
    ];
    for (const url of refused) expect(safeUrl(url), String(url)).toBeNull();
  });
});

describe("the connection's own lookup", () => {
  const lookup = (host: string) => new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((done) => guardedLookup(host, {}, (err, address) => done({ err, address })));

  it("refuses a name that resolves to this machine", async () => {
    const { err } = await lookup("localhost");
    expect(err?.code).toBe("ENOTPUBLIC");
  });

  it("refuses the request before anything is sent when the address is not one it asks", async () => {
    const ask = (url: string) => requestOverHttps({ method: "GET", url, headers: {}, maxBytes: 1000, timeoutMs: 1000 });
    await expect(ask("https://127.0.0.1/")).rejects.toThrow(/not an address/);
    await expect(ask("http://social.example/")).rejects.toThrow(/not an address/);
  });
});
