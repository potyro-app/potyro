// scripts/takedown.mjs, run as the operator runs it: a separate Node process.
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createShareHandler, type ShareRequest } from "../src/handler.ts";
import { diskShareStore } from "../src/disk.ts";
import { memoryShareStore } from "../src/store.ts";
import { startServer } from "../src/server.ts";
import { toBase64 } from "../src/wire.ts";

const SCRIPT = fileURLToPath(new URL("../scripts/takedown.mjs", import.meta.url));
const ADMIN = "an-operator-token-that-is-long-enough-0123456789";
const INDEX = "<!doctype html><html><head><title>Potyro</title></head><body></body></html>";

function run(args: string[], env: Record<string, string> = {}, flags: string[] = []): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [...flags, SCRIPT, ...args], { env: { PATH: process.env.PATH ?? "", ...env } }, (e, out, err) =>
      resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: String(out), err: String(err) }),
    );
  });
}

const req = (over: Partial<ShareRequest>): ShareRequest => ({ method: "GET", path: "/", headers: {}, body: new Uint8Array(), ip: "1.2.3.4", ...over });
const upload = { meta: { title: "Groceries", description: "", lang: "en" }, payload: toBase64(new Uint8Array([1, 2, 3])) };

async function makeShare(handle: ReturnType<typeof createShareHandler>): Promise<string> {
  const r = await handle(req({ method: "POST", path: "/share-api/shares", body: new TextEncoder().encode(JSON.stringify(upload)) }));
  return (JSON.parse(String(r.body)) as { id: string }).id;
}

let server: Server | null = null;
let dir = "";
afterEach(async () => {
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("scripts/takedown.mjs", () => {
  it("takes a link down over HTTP with the operator token, from a whole link, without sending its key", async () => {
    const seen: ShareRequest[] = [];
    const inner = createShareHandler({ store: memoryShareStore(), indexHtml: async () => INDEX, adminToken: ADMIN });
    const handle = async (r: ShareRequest) => (seen.push(r), inner(r));
    server = await startServer({ handle, port: 0, host: "127.0.0.1" });
    const site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const id = await makeShare(inner);

    const ok = await run([`${site}/s/${id}#k=the-secret-key`, "--reason", "notice 2026-11-02", "--site", site], { SHARE_ADMIN_TOKEN: ADMIN });
    expect(ok.err).toBe("");
    expect(ok.code).toBe(0);
    expect(ok.out).toContain(`Taken down: ${id}.`);
    expect(ok.out).not.toContain(ADMIN);
    expect(JSON.stringify(seen)).not.toContain("the-secret-key");
    expect((await inner(req({ path: `/s/${id}` }))).status).toBe(410);

    const again = await run([id, "--reason", "again", "--site", site], { SHARE_ADMIN_TOKEN: ADMIN });
    expect(again.out).toContain("Already taken down");

    const wrong = await run([id, "--reason", "x", "--site", site], { SHARE_ADMIN_TOKEN: "not-the-token" });
    expect(wrong.code).toBe(1);
    expect(wrong.err).toMatch(/answered 401/);
  });

  // The --dir mode loads the TypeScript store through Node 22's --experimental-strip-types, which is
  // what the server's node:22 container runs (docs/16). A Node without it (the CI machine's Node 20)
  // cannot run this mode at all, so the test is skipped there rather than failed: the takedown itself
  // is covered above through the HTTP route on every Node.
  const [major, minor] = process.versions.node.split(".").map(Number);
  const stripsTypes = major > 22 || (major === 22 && minor >= 6);
  it.skipIf(!stripsTypes)("writes straight into the shares folder on the server, with no token", async () => {
    dir = mkdtempSync(join(tmpdir(), "shares-"));
    const handle = createShareHandler({ store: diskShareStore(dir), indexHtml: async () => INDEX });
    const id = await makeShare(handle);
    expect((await handle(req({ path: `/s/${id}` }))).status).toBe(200);

    const ok = await run([id, "--reason", "notice 2026-11-02", "--dir", dir], {}, ["--experimental-strip-types", "--no-warnings"]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain(`Taken down: ${id}.`);
    expect((await handle(req({ path: `/s/${id}` }))).status).toBe(410);
    expect(await diskShareStore(dir).takenDown(id)).toMatchObject({ reason: "notice 2026-11-02" });

    const missing = await run(["B".repeat(22), "--reason", "x", "--dir", dir], {}, ["--experimental-strip-types", "--no-warnings"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/No link/);
  });

  it("sends the token only over https, or to this machine", async () => {
    const http = await run(["A".repeat(22), "--reason", "x", "--site", "http://potyro.app"], { SHARE_ADMIN_TOKEN: ADMIN });
    expect(http.code).toBe(1);
    expect(http.err).toMatch(/must start with https:\/\//);
    expect(http.err).not.toContain(ADMIN);
    const { siteBaseOf } = (await import(SCRIPT)) as { siteBaseOf: (s: string) => string };
    expect(siteBaseOf("https://potyro.app/")).toBe("https://potyro.app");
    expect(siteBaseOf("https://apps.example/potyro/")).toBe("https://apps.example/potyro");
    expect(siteBaseOf("http://localhost:4203")).toBe("http://localhost:4203");
    expect(siteBaseOf("http://127.0.0.1:4203")).toBe("http://127.0.0.1:4203");
    expect(() => siteBaseOf("ftp://potyro.app")).toThrow(/https/);
    expect(() => siteBaseOf("potyro.app")).toThrow(/not an address/);
  });

  it("wants one id and a reason, and says how", async () => {
    expect((await run(["not-an-id", "--reason", "x"])).code).toBe(2);
    const noReason = await run(["A".repeat(22)], { SHARE_ADMIN_TOKEN: ADMIN });
    expect(noReason.code).toBe(2);
    expect(noReason.err).toMatch(/--reason/);
    const noToken = await run(["A".repeat(22), "--reason", "x"]);
    expect(noToken.code).toBe(2);
    expect(noToken.err).toMatch(/SHARE_ADMIN_TOKEN is not set/);
  });
});
