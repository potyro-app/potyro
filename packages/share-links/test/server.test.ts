import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startServer } from "../src/server.ts";
import type { ShareRequest } from "../src/handler.ts";

let server: Server | null = null;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

describe("the share service's HTTP side", () => {
  it("rate-limits by the address the proxy appended, not one the client sent (#348)", async () => {
    const seen: ShareRequest[] = [];
    server = await startServer({
      handle: async (r) => (seen.push(r), { status: 200, headers: { "content-type": "application/json" }, body: "{}" }),
      port: 0,
      host: "127.0.0.1",
    });
    const { port } = server.address() as AddressInfo;
    // A client wrote its own X-Forwarded-For; Apache appended the real peer after it.
    const res = await fetch(`http://127.0.0.1:${port}/s/abc`, { headers: { "x-forwarded-for": "6.6.6.6, 9.9.9.9" } });
    expect(res.status).toBe(200);
    expect(seen[0]!.ip).toBe("9.9.9.9");
  });
});
