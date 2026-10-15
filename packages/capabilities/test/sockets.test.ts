// The page's live connections (docs/28 §6): which ws:// addresses can be reached at all, by spelling.
// (The mediation and limits are the host's: host/test/sockets.test.ts, against createFakeSockets.)

import { describe, expect, it } from "vitest";
import { createFakeSockets, isLocalAddress, isLoopback } from "../src/index.js";

describe("addresses", () => {
  it("knows the device itself", () => {
    for (const h of ["localhost", "app.localhost", "127.0.0.1", "127.8.9.10", "[::1]", "::1"]) expect(isLoopback(h), h).toBe(true);
    for (const h of ["192.168.1.2", "localhost.example.com", "128.0.0.1"]) expect(isLoopback(h), h).toBe(false);
  });

  it("knows the local network by its spelling", () => {
    for (const h of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.20", "169.254.3.4", "homeassistant.local", "[fd00::1]", "fc00::2", "fe80::1", "localhost"]) expect(isLocalAddress(h), h).toBe(true);
    for (const h of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "100.64.0.1", "example.com", "local.example.com", "2001:db8::1", "[2606:4700::1]"]) expect(isLocalAddress(h), h).toBe(false);
  });
});

describe("the fake server", () => {
  it("counts a connection from the moment it opens, and the page's closeAll ends it", async () => {
    const fake = createFakeSockets();
    const closes: string[] = [];
    await fake.cap.open("wss://echo.test/", {}, { message: () => {}, close: (_c, _r, why) => closes.push(why) });
    expect(fake.cap.openCount).toBe(1);
    fake.cap.closeAll("hidden");
    expect(closes).toEqual(["hidden"]);
    expect(fake.cap.openCount).toBe(0);
  });
});
