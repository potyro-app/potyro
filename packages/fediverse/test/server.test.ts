import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FediRequest } from "../src/core.ts";
import { diskStore } from "../src/disk.ts";
import { feedWatcher, readCount, readLimits, readProfile, startServer } from "../src/server.ts";
import { app, feed } from "./helpers.ts";

let server: Server | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
  server = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "potyro-fedi-"));
  dirs.push(d);
  return d;
};
const portOf = (s: Server) => (s.address() as AddressInfo).port;

describe("the service's HTTP side", () => {
  it("passes on the path, the query, the body and the address the proxy wrote", async () => {
    const seen: FediRequest[] = [];
    server = await startServer({ handle: async (r) => (seen.push(r), { status: 202, headers: { "content-type": "application/json" }, body: "{}" }), port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${portOf(server)}`;
    await fetch(`${base}/.well-known/webfinger?resource=acct:apps@potyro.com`, { headers: { "x-forwarded-for": "6.6.6.6, 9.9.9.9" } });
    const res = await fetch(`${base}/fedi/inbox`, { method: "POST", body: '{"type":"Follow"}', headers: { signature: 'keyId="k"' } });
    expect(res.status).toBe(202);
    expect(seen[0]).toMatchObject({ method: "GET", path: "/.well-known/webfinger", query: "?resource=acct:apps@potyro.com", ip: "9.9.9.9" });
    expect(seen[1]).toMatchObject({ method: "POST", path: "/fedi/inbox", query: "" });
    expect(Buffer.from(seen[1]!.body).toString()).toBe('{"type":"Follow"}');
    expect(seen[1]!.headers.signature).toBe('keyId="k"');
  });

  it("answers 413 to a body no activity could need, without handing it on", async () => {
    let handled = 0;
    server = await startServer({ handle: async () => (handled++, { status: 202, headers: {}, body: "{}" }), port: 0, host: "127.0.0.1" });
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/fedi/inbox`, { method: "POST", body: "x".repeat(400_000) });
    expect(res.status).toBe(413);
    expect(handled).toBe(0);
  });
});

describe("the environment", () => {
  it("the account is @apps@potyro.com unless it is said otherwise", () => {
    expect(readProfile({})).toMatchObject({ origin: "https://potyro.com", username: "apps", profileUrl: "https://potyro.com/apps/", assets: "https://potyro.com/", icon: "https://potyro.app/icon-512.png" });
    expect(readProfile({ FEDI_ORIGIN: "https://example.org/", FEDI_USERNAME: "gallery" })).toMatchObject({ origin: "https://example.org", username: "gallery", profileUrl: "https://example.org/apps/" });
  });

  it("reads the limits, and refuses a value that is not a count", () => {
    expect(readLimits({ FEDI_MAX_FOLLOWERS: "10" })).toMatchObject({ maxFollowers: 10, requestsPerMinute: 300 });
    expect(() => readCount({ FEDI_FEED_SECONDS: "often" }, "FEDI_FEED_SECONDS", 60)).toThrow(/FEDI_FEED_SECONDS/);
    expect(() => readLimits({ FEDI_LOOKUPS_PER_MINUTE: "0" })).toThrow(/above 0/);
  });
});

describe("watching the gallery's feed", () => {
  const watching = (files: { text: string | Error }) => {
    const taken: number[] = [];
    const said: string[] = [];
    const fedi = { sync: async (f: { apps: unknown[] }) => (taken.push(f.apps.length), { created: f.apps.map(() => "x"), updated: [], deleted: [] }) };
    const watch = feedWatcher(fedi, "/site/apps/feed.json", (m) => said.push(m), async () => {
      if (files.text instanceof Error) throw files.text;
      return files.text;
    });
    return { watch, taken, said };
  };

  it("hands a new feed to the account once, and again only when the file changes", async () => {
    const files = { text: JSON.stringify(feed([app("pantry")])) as string | Error };
    const { watch, taken, said } = watching(files);
    await watch();
    await watch();
    expect(taken).toEqual([1]);
    files.text = JSON.stringify(feed([app("pantry"), app("piano")]));
    await watch();
    expect(taken).toEqual([1, 2]);
    expect(said[0]).toMatch(/1 new/);
  });

  it("a file that is missing, cut short or wrong changes nothing, and is said once", async () => {
    const files = { text: new Error("ENOENT") as string | Error };
    const { watch, taken, said } = watching(files);
    await watch();
    await watch();
    files.text = '{"format":"potyro-gallery-feed/1","apps":[';
    await watch();
    files.text = JSON.stringify(feed([]));
    await watch();
    expect(taken).toEqual([]);
    expect(said).toHaveLength(3);
    expect(said[2]).toMatch(/no apps/);
    files.text = JSON.stringify(feed([app("pantry")]));
    await watch();
    expect(taken).toEqual([1]);
  });
});

describe("the account on disk", () => {
  it("makes its key once, keeps it to itself, and gives the same one after", async () => {
    const dir = tmp();
    const pem = await diskStore(dir).privateKey();
    expect(pem).toContain("BEGIN PRIVATE KEY");
    expect(statSync(join(dir, "key.pem")).mode & 0o777).toBe(0o600);
    expect(await diskStore(dir).privateKey()).toBe(pem);
  });

  it("keeps each part whole, readable by the service only, and null when it was never written", async () => {
    const dir = tmp();
    const store = diskStore(dir);
    expect(await store.read("followers")).toBeNull();
    const follower = { id: "https://social.example/users/ana", inbox: "https://social.example/users/ana/inbox", keyId: "k", publicKeyPem: "p", since: "2026-11-28T12:00:00.000Z" };
    await Promise.all([store.write("followers", {}), store.write("followers", { [follower.id]: follower })]);
    expect(await diskStore(dir).read("followers")).toEqual({ [follower.id]: follower });
    expect(statSync(join(dir, "followers.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "followers.json"), "utf8")).toContain("ana");
  });

  it("stops rather than start empty when a part is there and cannot be read", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "followers.json"), '{"cut sho');
    await expect(diskStore(dir).read("followers")).rejects.toThrow(/followers\.json cannot be read/);
  });
});
