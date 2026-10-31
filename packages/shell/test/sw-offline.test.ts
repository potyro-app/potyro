// The service worker keeps the whole shell for offline use (#123), exercised against the real
// `public/sw.js`, stamped with a build id the way the build stamps it.
//
// It used to cache only what it saw fetched. On a first visit the page's entry script is fetched
// before the worker is in charge, so after one visit online a reload with no network found the page
// and no script: a blank screen. And an app needs files Home never fetches (the bundler, the
// runtime's chunks). Pinned here: install keeps the boot list and this build's page, `warm` keeps
// the rest and says when it is done, one cache per build, older builds' caches dropped only once no
// open page runs them, one page for every offline navigation, and the servers behind the site never
// go through the cache at all.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stampServiceWorker } from "../src/sw-stamp.js";

const SW = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");
const ORIGIN = "https://potyro.app";
const LIST_KEY = "/__potyro_shell_list";

type Body = string | { body: string; headers: Record<string, string> };

interface Page {
  id: string;
  messages: unknown[];
  postMessage: (message: unknown) => void;
}

interface Harness {
  /** Every cache by name, each url → response. */
  caches: Map<string, Map<string, Response>>;
  fetched: string[];
  /** The open pages the worker can see; replace it to open or close one. */
  pages: Page[];
  online: boolean;
  fire: (name: "install" | "activate" | "message", data?: unknown, source?: Page) => Promise<void>;
  /** A request through the fetch handler: its answer, or "network" when the worker stayed out of it. */
  request: (path: string, mode?: "navigate" | "no-cors") => Promise<Response | "network">;
}

function page(id: string): Page {
  const p: Page = { id, messages: [], postMessage: (m) => void p.messages.push(m) };
  return p;
}

/** A worker global with real-ish caches and a network answering from `files` (404 otherwise). */
function runWorker(files: Record<string, Body>, seed: Record<string, Record<string, string>> = {}, build = "b2"): Harness {
  const abs = (req: string | { url: string }): string => new URL(typeof req === "string" ? req : req.url, ORIGIN).href;
  const all = new Map<string, Map<string, Response>>();
  const fetched: string[] = [];
  const h = { caches: all, fetched, pages: [] as Page[], online: true } as Harness;

  const network = async (req: string | { url: string }): Promise<Response> => {
    const path = new URL(abs(req)).pathname;
    fetched.push(path);
    if (!h.online) throw new TypeError("Failed to fetch");
    const file = files[path];
    if (file === undefined) return new Response("missing", { status: 404 });
    const { body, headers } = typeof file === "string" ? { body: file, headers: {} } : file;
    return new Response(body, { headers: { vary: "Origin", ...headers } });
  };
  const open = (name: string) => {
    let store = all.get(name);
    if (!store) all.set(name, (store = new Map()));
    const s = store;
    return {
      put: async (req: string | { url: string }, res: Response) => void s.set(abs(req), res),
      delete: async (req: string | { url: string }) => s.delete(abs(req)),
      match: async (req: string | { url: string }) => s.get(abs(req))?.clone(),
      keys: async () => [...s.keys()].map((url) => ({ url })),
    };
  };
  for (const [name, entries] of Object.entries(seed)) {
    const c = open(name);
    for (const [path, body] of Object.entries(entries)) void c.put(path, new Response(body));
  }
  const caches = {
    open: async (name: string) => open(name),
    keys: async () => [...all.keys()],
    delete: async (name: string) => all.delete(name),
    match: async (req: string | { url: string }) => {
      for (const store of all.values()) {
        const hit = store.get(abs(req));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (name: string, fn: (event: unknown) => void) => void listeners.set(name, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {}, matchAll: async () => [...h.pages] },
    registration: { unregister: async () => true },
  };
  (new Function("self", "caches", "fetch", stampServiceWorker(SW, build)) as (s: unknown, c: unknown, f: unknown) => void)(self, caches, network);

  h.fire = async (name, data, source) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(name)!({ data, source, waitUntil: (p: Promise<unknown>) => void waits.push(p) });
    await Promise.all(waits);
  };
  h.request = async (path, mode = "no-cors") => {
    let answer: Promise<Response> | null = null;
    listeners.get("fetch")!({
      request: { url: abs(path), method: "GET", mode },
      respondWith: (p: Promise<Response>) => void (answer = p),
    });
    if (!answer) return "network";
    const res = await answer;
    // The cache writes are deliberately not awaited by the worker.
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    return res;
  };
  return h;
}

const PAGE = '<!doctype html><script type="module" src="/assets/index-new.js"></script>';
const OLD_PAGE = '<!doctype html><script type="module" src="/assets/index-old.js"></script>';
const LIST = {
  build: "b2",
  entry: "/assets/index-new.js",
  boot: ["/assets/index-new.css", "/assets/index-new.js", "/manifest.webmanifest"],
  rest: ["/assets/bundler-new.js", "/assets/esbuild-new.wasm", "/assets/messages-de.js"],
};
const FILES: Record<string, Body> = {
  "/": PAGE,
  "/shell-precache.json": JSON.stringify(LIST),
  "/i18n-precache.json": JSON.stringify({ files: ["/assets/messages-de.js"] }),
  "/assets/index-new.js": "entry",
  "/assets/index-new.css": "styles",
  "/manifest.webmanifest": "{}",
  "/assets/bundler-new.js": "bundler",
  "/assets/esbuild-new.wasm": "wasm",
  "/assets/messages-de.js": "de",
};
const OWN = "potyro-b2";
const OLD = "potyro-b1";
const cached = (h: Harness, name = OWN): string[] =>
  [...(h.caches.get(name)?.keys() ?? [])]
    .map((u) => new URL(u).pathname + new URL(u).search)
    .filter((p) => p !== LIST_KEY)
    .sort();
/** This build's cache with only its list and its boot files, as if the page itself had not been kept yet. */
function bootOnly(h: Harness): void {
  const own = new Map<string, Response>([[`${ORIGIN}${LIST_KEY}`, new Response(JSON.stringify(LIST))]]);
  for (const f of LIST.boot) own.set(`${ORIGIN}${f}`, new Response("x"));
  h.caches.set(OWN, own);
}

describe("offline after one visit", () => {
  it("install keeps the page and everything it needs to boot, in this build's own cache", async () => {
    const worker = runWorker(FILES);
    await worker.fire("install");
    expect([...worker.caches.keys()]).toEqual([OWN]);
    expect(cached(worker)).toEqual(["/", "/assets/index-new.css", "/assets/index-new.js", "/assets/messages-de.js", "/manifest.webmanifest"]);
  });

  it("kept copies match a module-script request: Vary is dropped", async () => {
    const worker = runWorker(FILES);
    await worker.fire("install");
    expect(worker.caches.get(OWN)!.get(`${ORIGIN}/assets/index-new.js`)!.headers.get("vary")).toBeNull();
  });

  it("warm keeps the rest of the build, fetches nothing it already has, and tells every open page it is done", async () => {
    const worker = runWorker(FILES);
    await worker.fire("install");
    const a = page("a");
    const b = page("b");
    worker.pages = [a, b];
    worker.fetched.length = 0;
    await worker.fire("message", { type: "warm" }, a);
    expect(cached(worker)).toEqual(expect.arrayContaining(["/assets/bundler-new.js", "/assets/esbuild-new.wasm"]));
    // The list itself, and only the files not kept yet.
    expect(worker.fetched.sort()).toEqual(["/assets/bundler-new.js", "/assets/esbuild-new.wasm", "/shell-precache.json"]);
    for (const p of [a, b]) expect(p.messages).toContainEqual({ type: "offline", ready: true, warming: false, done: true });
  });

  it("says how much is kept when asked: not everything until warm has run", async () => {
    const worker = runWorker(FILES);
    await worker.fire("install");
    const a = page("a");
    await worker.fire("message", { type: "status" }, a);
    expect(a.messages).toEqual([{ type: "offline", ready: false, warming: false, done: false }]);
  });

  it("a warm cut short reports not ready when it is done", async () => {
    const files = { ...FILES };
    const worker = runWorker(files);
    await worker.fire("install");
    delete files["/assets/esbuild-new.wasm"];
    const a = page("a");
    worker.pages = [a];
    await worker.fire("message", { type: "warm" }, a);
    expect(a.messages.at(-1)).toEqual({ type: "offline", ready: false, warming: false, done: true });
  });

  it("a build without the list, or a network that fails, neither breaks install nor empties the cache", async () => {
    const { "/shell-precache.json": _list, ...noList } = FILES;
    const worker = runWorker(noList, { [OWN]: { "/assets/index-old.js": "old entry" } });
    await expect(worker.fire("install")).resolves.toBeUndefined();
    await worker.fire("message", { type: "warm" });
    expect(cached(worker)).toContain("/assets/index-old.js");

    const offline = runWorker({});
    offline.online = false;
    await expect(offline.fire("install")).resolves.toBeUndefined();
    await expect(offline.fire("message", { type: "warm" })).resolves.toBeUndefined();
  });

  it("does not fill this build's cache from a newer build the server already has", async () => {
    const files = { ...FILES };
    const worker = runWorker(files);
    await worker.fire("install");
    // A release lands; this worker is still in charge until the next one installs.
    files["/shell-precache.json"] = JSON.stringify({ ...LIST, build: "b3", rest: [...LIST.rest, "/assets/bundler-b3.js"] });
    files["/assets/bundler-b3.js"] = "b3";
    await worker.fire("message", { type: "warm" });
    expect(cached(worker)).toContain("/assets/bundler-new.js");
    expect(cached(worker)).not.toContain("/assets/bundler-b3.js");
  });

  it("ignores messages it does not know", async () => {
    const worker = runWorker(FILES);
    await worker.fire("message", { type: "something-else" });
    await worker.fire("message", null);
    expect(worker.fetched).toEqual([]);
  });
});

describe("one page for every offline navigation", () => {
  it("a deep link opened offline after a release gets this build's page, not an older copy of that address", async () => {
    // The blank screen: `/?user=groceries` kept under its own address by an older build named that
    // build's entry script, which the newer build's tidy-up had deleted.
    const worker = runWorker(FILES, { [OLD]: { "/?user=groceries": OLD_PAGE, "/": OLD_PAGE } });
    await worker.fire("install");
    worker.online = false;
    const res = await worker.request("/?user=groceries", "navigate");
    expect(res).not.toBe("network");
    expect(await (res as Response).text()).toBe(PAGE);
  });

  it("keeps a navigation as the one page, without its search", async () => {
    const worker = runWorker(FILES);
    bootOnly(worker);
    await worker.request("/?user=groceries", "navigate");
    expect(cached(worker)).toContain("/");
    expect(cached(worker)).not.toContain("/?user=groceries");
  });

  it("never keeps another build's page, at install or on a navigation", async () => {
    const worker = runWorker({ ...FILES, "/": OLD_PAGE });
    await worker.fire("install");
    expect(cached(worker)).not.toContain("/");
    await worker.request("/", "navigate");
    expect(cached(worker)).not.toContain("/");
  });

  it("does not keep the page while the files it loads are missing", async () => {
    const worker = runWorker(FILES);
    worker.caches.set(OWN, new Map([[`${ORIGIN}${LIST_KEY}`, new Response(JSON.stringify(LIST))]]));
    await worker.request("/", "navigate");
    expect(cached(worker)).not.toContain("/");
  });
});

describe("older builds", () => {
  const seedOld = { [OLD]: { "/assets/index-old.js": "old entry", "/assets/bundler-old.js": "old bundler", "/": OLD_PAGE } };

  it("keeps the previous build's cache while a page of that build is open, and drops it once none is", async () => {
    const worker = runWorker(FILES, seedOld);
    await worker.fire("install");
    const old = page("old-tab");
    worker.pages = [old];
    await worker.fire("activate");
    // It has not heard from that page: it asks, and deletes nothing.
    expect(old.messages).toContainEqual({ type: "potyro-build?" });
    expect(worker.caches.has(OLD)).toBe(true);

    await worker.fire("message", { type: "hello", entry: "/assets/index-old.js" }, old);
    await worker.fire("message", { type: "warm" }, old);
    expect(worker.caches.has(OLD)).toBe(true);
    expect(cached(worker, OLD)).toContain("/assets/bundler-old.js");

    // The old tab is reloaded onto this build.
    const fresh = page("fresh-tab");
    worker.pages = [fresh];
    await worker.fire("message", { type: "hello", entry: "/assets/index-new.js" }, fresh);
    expect(worker.caches.has(OLD)).toBe(false);
    expect(worker.caches.has(OWN)).toBe(true);
  });

  it("drops an older build's files left in this cache only once no page of that build is open", async () => {
    const worker = runWorker(FILES);
    await worker.fire("install");
    const old = page("old-tab");
    worker.pages = [old];
    await worker.fire("message", { type: "hello", entry: "/assets/index-old.js" }, old);
    worker.caches.get(OWN)!.set(`${ORIGIN}/assets/lazy-old.js`, new Response("old chunk"));
    worker.caches.get(OWN)!.set(`${ORIGIN}/potyro-faces/1.0/model.task`, new Response("faces"));
    await worker.fire("message", { type: "warm" }, old);
    expect(cached(worker)).toContain("/assets/lazy-old.js");

    const fresh = page("fresh-tab");
    worker.pages = [fresh];
    await worker.fire("message", { type: "hello", entry: "/assets/index-new.js" }, fresh);
    expect(cached(worker)).not.toContain("/assets/lazy-old.js");
    expect(cached(worker)).toContain("/potyro-faces/1.0/model.task");
    expect(cached(worker)).toContain("/");
  });

  it("deletes nothing while an open page has not said which build it runs", async () => {
    const worker = runWorker(FILES, seedOld);
    await worker.fire("install");
    const known = page("known");
    const silent = page("silent");
    worker.pages = [known, silent];
    await worker.fire("message", { type: "hello", entry: "/assets/index-new.js" }, known);
    await worker.fire("message", { type: "warm" }, known);
    expect(worker.caches.has(OLD)).toBe(true);
    expect(silent.messages).toContainEqual({ type: "potyro-build?" });
  });
});

describe("what never goes through the cache", () => {
  it("the servers behind the site and share links go straight to the network", async () => {
    const worker = runWorker(FILES);
    await worker.fire("install");
    for (const path of ["/ai/chat", "/share-api/shares/abc/payload", "/requests/health", "/rooms/health", "/s/abc123/preview.jpg"]) {
      expect(await worker.request(path), path).toBe("network");
    }
    expect(await worker.request("/s/abc123", "navigate")).toBe("network");
  });

  it("a response marked no-store is answered and never kept", async () => {
    const noStore = { body: "fresh", headers: { "cache-control": "no-store" } };
    const worker = runWorker({ ...FILES, "/assets/live.json": noStore, "/assets/esbuild-new.wasm": noStore });
    await worker.fire("install");
    const res = await worker.request("/assets/live.json");
    expect(await (res as Response).text()).toBe("fresh");
    await worker.fire("message", { type: "warm" });
    const everywhere = [...worker.caches.keys()].flatMap((name) => cached(worker, name));
    expect(everywhere).toContain("/assets/bundler-new.js");
    expect(everywhere).not.toContain("/assets/live.json");
    expect(everywhere).not.toContain("/assets/esbuild-new.wasm");
  });
});

describe("the build's stamp", () => {
  it("replaces the placeholder line, and refuses a worker that has lost it", () => {
    expect(stampServiceWorker(SW, "abc123")).toContain('const BUILD = "abc123";');
    expect(() => stampServiceWorker("const CACHE = 'x';", "abc123")).toThrow(/no `const BUILD/);
    expect(() => stampServiceWorker(SW, 'x"; evil()')).toThrow(/not a build id/);
  });
});
