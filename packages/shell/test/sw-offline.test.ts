// The service worker keeps the whole shell for offline use (#123), exercised against the real
// `public/sw.js`.
//
// It used to cache only what it saw fetched. On a first visit the page's entry script is fetched
// before the worker is in charge, so after one visit online a reload with no network found the page
// and no script: a blank screen. And an app needs files Home never fetches (the bundler, the
// runtime's chunks). Pinned here: install keeps the boot list, `warm` keeps the rest and drops older
// builds' files, and none of it can fail the install.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SW = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");
const ORIGIN = "https://potyro.app";

interface Harness {
  store: Map<string, Response>;
  fetched: string[];
  fire: (name: "install" | "message", data?: unknown) => Promise<void>;
}

/** A worker global with a real-ish cache and a network answering from `files` (404 otherwise). */
function runWorker(files: Record<string, string>, seed: Record<string, string> = {}): Harness {
  const store = new Map<string, Response>();
  const abs = (req: string | { url: string }): string => new URL(typeof req === "string" ? req : req.url, ORIGIN).href;
  for (const [path, body] of Object.entries(seed)) store.set(abs(path), new Response(body));
  const cache = {
    add: async (req: string) => {
      const res = await network(req);
      if (!res.ok) throw new Error("add failed");
      store.set(abs(req), res);
    },
    put: async (req: string | { url: string }, res: Response) => void store.set(abs(req), res),
    delete: async (req: string | { url: string }) => store.delete(abs(req)),
    match: async (req: string | { url: string }) => store.get(abs(req))?.clone(),
    keys: async () => [...store.keys()].map((url) => ({ url })),
  };
  const fetched: string[] = [];
  const network = async (req: string | { url: string }): Promise<Response> => {
    const path = new URL(abs(req)).pathname;
    fetched.push(path);
    return path in files ? new Response(files[path], { headers: { vary: "Origin" } }) : new Response("missing", { status: 404 });
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (name: string, fn: (event: unknown) => void) => void listeners.set(name, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    registration: { unregister: async () => true },
  };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true, match: cache.match };
  (new Function("self", "caches", "fetch", SW) as (s: unknown, c: unknown, f: unknown) => void)(self, caches, network);

  const fire = async (name: "install" | "message", data?: unknown): Promise<void> => {
    const waits: Promise<unknown>[] = [];
    listeners.get(name)!({ data, waitUntil: (p: Promise<unknown>) => void waits.push(p) });
    await Promise.all(waits);
  };
  return { store, fetched, fire };
}

const LIST = JSON.stringify({
  boot: ["/assets/index-new.js", "/assets/index-new.css", "/manifest.webmanifest"],
  rest: ["/assets/bundler-new.js", "/assets/esbuild-new.wasm", "/assets/messages-de.js"],
});
const FILES: Record<string, string> = {
  "/": "<!doctype html>",
  "/shell-precache.json": LIST,
  "/i18n-precache.json": JSON.stringify({ files: ["/assets/messages-de.js"] }),
  "/assets/index-new.js": "entry",
  "/assets/index-new.css": "styles",
  "/manifest.webmanifest": "{}",
  "/assets/bundler-new.js": "bundler",
  "/assets/esbuild-new.wasm": "wasm",
  "/assets/messages-de.js": "de",
};
const cached = (h: Harness): string[] => [...h.store.keys()].map((u) => new URL(u).pathname).sort();

describe("offline after one visit", () => {
  it("install keeps the page and everything it needs to boot, not only the page", async () => {
    const worker = runWorker(FILES);
    await worker.fire("install");
    expect(cached(worker)).toEqual(["/", "/assets/index-new.css", "/assets/index-new.js", "/assets/messages-de.js", "/manifest.webmanifest"]);
  });

  it("kept copies match a module-script request: Vary is dropped", async () => {
    const worker = runWorker(FILES);
    await worker.fire("install");
    expect(worker.store.get(`${ORIGIN}/assets/index-new.js`)!.headers.get("vary")).toBeNull();
  });

  it("warm keeps the rest of the build, and fetches nothing it already has", async () => {
    const worker = runWorker(FILES);
    await worker.fire("install");
    worker.fetched.length = 0;
    await worker.fire("message", { type: "warm" });
    expect(cached(worker)).toEqual(expect.arrayContaining(["/assets/bundler-new.js", "/assets/esbuild-new.wasm"]));
    // The list itself, and only the files not kept yet.
    expect(worker.fetched.sort()).toEqual(["/assets/bundler-new.js", "/assets/esbuild-new.wasm", "/shell-precache.json"]);
  });

  it("warm drops an older build's files and leaves everything else alone", async () => {
    const worker = runWorker(FILES, {
      "/assets/index-old.js": "old entry",
      "/assets/bundler-old.js": "old bundler",
      "/potyro-faces/1.0/model.task": "faces",
      "/?user=groceries": "<!doctype html>",
    });
    await worker.fire("message", { type: "warm" });
    const kept = cached(worker);
    expect(kept).not.toContain("/assets/index-old.js");
    expect(kept).not.toContain("/assets/bundler-old.js");
    expect(kept).toContain("/potyro-faces/1.0/model.task");
    expect(kept).toContain("/");
  });

  it("a build without the list, or a network that fails, neither breaks install nor empties the cache", async () => {
    const { "/shell-precache.json": _list, ...noList } = FILES;
    const worker = runWorker(noList, { "/assets/index-old.js": "old entry" });
    await expect(worker.fire("install")).resolves.toBeUndefined();
    await worker.fire("message", { type: "warm" });
    expect(cached(worker)).toContain("/assets/index-old.js");

    const offline = runWorker({});
    await expect(offline.fire("install")).resolves.toBeUndefined();
    await expect(offline.fire("message", { type: "warm" })).resolves.toBeUndefined();
  });

  it("ignores messages that are not a warm request", async () => {
    const worker = runWorker(FILES);
    await worker.fire("message", { type: "something-else" });
    await worker.fire("message", null);
    expect(worker.fetched).toEqual([]);
  });
});
