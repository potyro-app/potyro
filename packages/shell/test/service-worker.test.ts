// The service worker's caching rules, exercised against the real `public/sw.js`.
//
// It cached whatever came back. A worker's fetch cannot answer an HTTP auth challenge — there is no
// UI for it to ask with — so behind the basic-auth gate on apps.vaz.io one request came back 401,
// was cached, and (assets being served cache-first) was then served for ever. The site read
// "Unauthorized" and the only way back was to delete every trace of the origin:
//
//   "firefox tab started to show Unauthorized … and this was the only way to access again
//    apps.vaz.io without forcing to delete all local data for it"
//
// A cache that can poison itself with an error is worse than no cache, so what is pinned here is:
// only successful responses are stored, and an auth failure throws away what was there.

import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SW = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");

/** The pieces of the service worker global the script actually touches. */
function runWorker(): {
  fetchHandler: (event: FakeEvent) => void;
  cache: Map<string, { status: number; body: string }>;
} {
  const store = new Map<string, { status: number; body: string }>();
  const cache = {
    add: async () => undefined,
    put: async (req: { url: string }, res: { status: number; body: string }) => void store.set(req.url, res),
    delete: async (req: { url: string }) => store.delete(req.url),
    match: async (req: { url: string } | string) => store.get(typeof req === "string" ? req : req.url),
  };
  const listeners = new Map<string, (event: FakeEvent) => void>();
  const self = {
    addEventListener: (name: string, fn: (event: FakeEvent) => void) => void listeners.set(name, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const caches = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
    match: async (req: { url: string } | string) => cache.match(req),
  };

  // The script is plain JS written for a worker global; give it one.
  const run = new Function("self", "caches", "fetch", SW) as (s: unknown, c: unknown, f: unknown) => void;
  run(self, caches, fetchImpl);
  return { fetchHandler: listeners.get("fetch")!, cache: store };
}

interface FakeEvent {
  request: { url: string; method: string; mode: string };
  respondWith: (p: Promise<unknown>) => void;
  waitUntil: (p: Promise<unknown>) => void;
}

let nextResponse: { status: number; body: string };
const fetchImpl = async (): Promise<unknown> => ({
  ...nextResponse,
  ok: nextResponse.status >= 200 && nextResponse.status < 300,
  clone() {
    return { ...nextResponse };
  },
});

/** Drive one request through the worker and wait for its cache writes to settle. */
async function request(
  worker: ReturnType<typeof runWorker>,
  url: string,
  status: number,
  mode: "no-cors" | "navigate" = "no-cors",
): Promise<void> {
  nextResponse = { status, body: status === 200 ? "the asset" : "Unauthorized" };
  let answered: Promise<unknown> = Promise.resolve();
  worker.fetchHandler({
    request: { url, method: "GET", mode },
    respondWith: (p) => void (answered = p),
    waitUntil: () => {},
  });
  await answered;
  await new Promise((r) => setTimeout(r, 0)); // the cache write is deliberately not awaited
}

beforeEach(() => {
  nextResponse = { status: 200, body: "the asset" };
});

describe("the service worker's cache", () => {
  const asset = "https://apps.vaz.io/assets/index-abc.js";

  it("keeps a successful response", async () => {
    const worker = runWorker();
    await request(worker, asset, 200);
    expect(worker.cache.get(asset)?.status).toBe(200);
  });

  it("never keeps an Unauthorized", async () => {
    // The one that broke the site. Cached once, served cache-first for ever.
    const worker = runWorker();
    await request(worker, asset, 401);
    expect(worker.cache.has(asset)).toBe(false);
  });

  it("never keeps a 404 or a 500 either", async () => {
    const worker = runWorker();
    await request(worker, asset, 404);
    await request(worker, "https://apps.vaz.io/assets/other.js", 500);
    expect(worker.cache.size).toBe(0);
  });

  it("throws away the cached page when a navigation comes back Unauthorized", async () => {
    // Documents are fetched network-first, so this is the path that can see an auth failure at all —
    // and recovering from one has to be a reload, not "delete all site data for this origin".
    const worker = runWorker();
    const page = "https://apps.vaz.io/";
    await request(worker, page, 200, "navigate");
    expect(worker.cache.has(page)).toBe(true);

    await request(worker, page, 401, "navigate");
    expect(worker.cache.has(page)).toBe(false);
  });

  it("serves an asset it already has rather than asking again", async () => {
    // The flip side, and the reason the eviction above is only on the document: once a hashed asset
    // is cached it is never re-fetched, so a later auth failure cannot reach it.
    const worker = runWorker();
    await request(worker, asset, 200);
    await request(worker, asset, 401);
    expect(worker.cache.get(asset)?.status).toBe(200);
  });
});
