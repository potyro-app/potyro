// Offline-first service worker for the PWA target (docs/07). PRODUCTION ONLY — main.tsx refuses to
// register this in dev and tears down any existing registration, because a cache-first SW makes
// every edit invisible until the cache happens to miss.
//
// Strategy differs by request kind, which the previous cache-first-for-everything version got wrong:
//   navigations     → NETWORK FIRST, the kept page as fallback. A stale document replays an old build.
//                     That surfaced as "changing route shows the old version", and as an app being
//                     trusted via a typed URL but untrusted via the in-app launcher — both are real
//                     navigations, and one was served from cache.
//   everything else → cache first (hashed assets are immutable, so this stays fast and safe).
//
// ONLY successful responses are ever cached, and a 401 or 403 evicts whatever was there. A worker's
// fetch cannot answer an HTTP auth challenge — it has no UI to ask with — so behind a basic-auth
// gate one unlucky request comes back 401. Cached, and served cache-first ever after, that 401
// became permanent: the site read "Unauthorized" and the only way back in was to delete all site
// data for the origin. A cache that can poison itself with an error is worse than no cache.
//
// A 401 on a NAVIGATION is handled differently again: the worker gets out of the way entirely. The
// browser only shows its password box for a navigation IT performs, and a worker-handled navigation
// is not one — so behind a basic-auth gate the worker turns "ask me for the password" into "here is
// the server's error page", intermittently, whenever the browser has forgotten the credentials it
// was silently attaching. See `stepAside` below.
//
// What never goes through the cache at all: the servers behind the site (`/ai/`, `/share-api/`,
// `/requests/`, `/rooms/`) and share links (`/s/<id>`, whose page carries that link's own preview
// and can be taken down). Those requests go to the network as if there were no worker, and nothing
// they return is kept. Nor is any response that says `Cache-Control: no-store`.
//
// ONE CACHE PER BUILD (#123). The build stamps `BUILD` below (`precacheShell` in
// packages/shell/vite.config.ts writes the same id into `shell-precache.json`), so every release
// is a new worker with its own cache, `potyro-<build>`. Install keeps that build's boot files and
// its page; `warm` keeps the rest.
//
// Old caches are dropped only when no open page needs them. A page left open on the previous
// build (a home-screen app sitting in the background is the usual case) still loads that build's
// lazy chunks, and they live in the previous build's cache. So each page tells the worker which
// build it runs (`hello`, carrying its entry script's path), the worker asks every page it has not
// heard from (`potyro-build?`), and only once every open page has answered does it delete the caches
// no page is running from. A page that never answers keeps every old cache in place: a cache
// left a little too long costs space, one deleted too early costs a blank screen.
//
// Offline, EVERY navigation gets this build's own copy of the page, keyed "/" whatever the address
// said (`/?user=…` is a route of the same page, not another document). That copy is only ever
// written when this build's boot files are in the same cache, and only if it is this build's page
// (it names this build's entry script). A cache is deleted whole, never the files its page names,
// so an offline deep link cannot get a page whose scripts are gone.

const BUILD = "__POTYRO_BUILD__";
const PREFIX = "potyro-";
const CACHE = PREFIX + BUILD;
/** The page, whatever route it was asked for with. */
const SHELL = "/";
/** This build's list of its own files, kept beside them so it can be read offline. */
const LIST_KEY = "/__potyro_shell_list";
/** Never through the cache: the site's servers, and share links. */
const BYPASS = ["/ai/", "/share-api/", "/requests/", "/rooms/", "/s/"];

function bypassed(req) {
  const path = new URL(req.url).pathname;
  return BYPASS.some((prefix) => path.startsWith(prefix));
}

/** A response that may be kept: a success that does not ask not to be stored. */
function storable(res) {
  if (!res || !res.ok) return false;
  const cacheControl = (res.headers && res.headers.get("cache-control")) || "";
  return !/no-store/i.test(cacheControl);
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Pre-caching the shell is an optimisation, not a precondition: a rejection here would fail the
  // whole install, and behind an auth gate a single 401 would leave the previous worker in place
  // indefinitely. Everything below swallows its own failures.
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        const list = await fetchList();
        if (list) await cache.put(LIST_KEY, new Response(JSON.stringify(list))).catch(() => {});
        await Promise.all([precacheCatalogs(cache), ...(list ? list.boot : []).map((url) => keep(cache, url))]);
        // The page last, once what it loads is here.
        await keepShell(cache, list);
      })
      .catch(() => {}),
  );
});

/** The build's list of its own files, from the network (packages/shell/vite.config.ts `precacheShell`). */
function fetchList() {
  return fetch("/shell-precache.json", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : null))
    .then(readList)
    .catch(() => null);
}

function readList(list) {
  if (!list || typeof list !== "object") return null;
  return {
    build: typeof list.build === "string" ? list.build : "",
    entry: typeof list.entry === "string" ? list.entry : "",
    boot: Array.isArray(list.boot) ? list.boot : [],
    rest: Array.isArray(list.rest) ? list.rest : [],
  };
}

/** This build's list, as kept at install. */
function ownList(cache) {
  return cache
    .match(LIST_KEY)
    .then((hit) => (hit ? hit.json() : null))
    .then(readList)
    .catch(() => null);
}

/**
 * The list to fill this build's cache from: the server's when it is this build's, else the kept
 * one. A server already on a NEWER build is the next worker's business; filling this cache with its
 * files would only mix two builds in one cache.
 */
async function currentList(cache) {
  const kept = await ownList(cache);
  const fetched = await fetchList();
  if (fetched && fetched.build === BUILD) {
    if (!kept) await cache.put(LIST_KEY, new Response(JSON.stringify(fetched))).catch(() => {});
    return fetched;
  }
  return kept;
}

/** Fetch one file into the cache unless it is there already. Never rejects. */
function keep(cache, url) {
  return cache
    .match(url)
    .then((hit) => (hit ? undefined : fetch(url).then((res) => (storable(res) ? cache.put(url, withoutVary(res)) : undefined))))
    .catch(() => {});
}

/** Are all of this build's boot files in its cache? Its page is only worth keeping if so. */
async function bootKept(cache, list) {
  if (!list) return true;
  const hits = await Promise.all(list.boot.map((url) => cache.match(url)));
  return hits.every(Boolean);
}

/** Is this HTML this build's page? It names this build's entry script. */
async function isOwnPage(res, list) {
  if (!list || !list.entry) return true;
  const html = await res.clone().text();
  return html.includes(list.entry);
}

/** The page, fresh, into this build's cache: only when it is this build's and its files are here. */
async function keepShell(cache, list) {
  try {
    const res = await fetch(SHELL, { cache: "reload" });
    if (!storable(res) || !(await isOwnPage(res, list)) || !(await bootKept(cache, list))) return;
    await cache.put(SHELL, res);
  } catch {
    // Offline or refused: the next navigation online keeps it instead.
  }
}

/**
 * Everything else the build made, after the worker has taken over: an example app opened for the
 * first time on a plane needs the bundler and the runtime's chunks, which Home never fetches. Only
 * when the page asks (`warm`): automatically on Wi-Fi or a cable, otherwise when the person chooses
 * it in You (packages/shell/src/offline-ready.ts). An interrupted run carries on next time; four
 * at a time; already-kept files cost one cache lookup. Then every open page hears how far it got.
 */
let warming = null;
function warm() {
  warming ??= caches
    .open(CACHE)
    .then(async (cache) => {
      const list = await currentList(cache);
      if (!list) return;
      const queue = [...list.boot, ...list.rest];
      const worker = async () => {
        while (queue.length) await keep(cache, queue.shift());
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      // The page too, now that its files are surely here.
      if (!(await cache.match(SHELL))) await keepShell(cache, list);
    })
    .catch(() => {})
    .finally(() => {
      warming = null;
    });
  return warming.then(() => prune()).then(() => broadcast());
}

/** Is all of this build kept? What the You panel's "Everything works offline" waits for. */
async function offlineReady() {
  const cache = await caches.open(CACHE);
  const list = await ownList(cache);
  if (!list) return false;
  const hits = await Promise.all([...list.boot, ...list.rest, SHELL].map((url) => cache.match(url)));
  return hits.every(Boolean);
}

async function statusMessage(done = false) {
  const ready = await offlineReady().catch(() => false);
  return { type: "offline", ready, warming: !done && warming !== null, done };
}

function windows() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true });
}

/** A run of `warm` has finished: tell every open page how much of Potyro is kept. */
async function broadcast() {
  const [message, pages] = await Promise.all([statusMessage(true), windows()]);
  for (const page of pages) page.postMessage(message);
}

/** Which build each open page runs: client id → the path of its entry script. */
const runs = new Map();
let pruning = Promise.resolve();
function prune() {
  pruning = pruning.then(pruneNow).catch(() => {});
  return pruning;
}

/**
 * Drop what no open page can need (see the header): older builds' caches, and stray files of older
 * builds a page of theirs left in this one. Nothing at all until every open page has said which
 * build it runs.
 */
async function pruneNow() {
  const cache = await caches.open(CACHE);
  const list = await ownList(cache);
  if (!list) return;
  const pages = await windows();
  for (const id of [...runs.keys()]) if (!pages.some((page) => page.id === id)) runs.delete(id);
  const unheard = pages.filter((page) => !runs.has(page.id));
  if (unheard.length) {
    for (const page of unheard) page.postMessage({ type: "potyro-build?" });
    return;
  }
  const mine = new Set(list.boot);
  const elsewhere = [...new Set(pages.map((page) => runs.get(page.id)))].filter((entry) => !mine.has(entry));
  for (const key of await caches.keys()) {
    if (key === CACHE || !key.startsWith(PREFIX)) continue;
    const old = await caches.open(key);
    const inUse = (await Promise.all(elsewhere.map((entry) => old.match(entry)))).some(Boolean);
    if (!inUse) await caches.delete(key);
  }
  // A page of another build is still open: what it stashed here may be its only copy.
  if (elsewhere.length) return;
  const current = new Set([...list.boot, ...list.rest]);
  const kept = await cache.keys();
  await Promise.all(
    kept
      .map((req) => new URL(req.url))
      .filter((url) => url.pathname.startsWith("/assets/") && !current.has(url.pathname))
      .map((url) => cache.delete(url.href)),
  );
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "warm") event.waitUntil(warm());
  else if (data.type === "status" && event.source) event.waitUntil(statusMessage().then((m) => event.source.postMessage(m)));
  else if (data.type === "hello" && event.source && typeof data.entry === "string") {
    runs.set(event.source.id, data.entry);
    event.waitUntil(prune());
  }
});

/**
 * The response, minus its `Vary` header. Fetched here it was a plain request; the page later asks
 * for it as a module script, which carries an `Origin` header — and a server that answers
 * `Vary: Origin` (Vite's preview does) makes `caches.match` refuse the copy for that request. Offline
 * the language then fell through to the HTML fallback and failed to load as a script. The file is
 * content-hashed and the same for every origin, so nothing is lost by dropping it.
 */
function withoutVary(res) {
  const headers = new Headers(res.headers);
  headers.delete("vary");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Every language's catalog chunk, so switching language works offline (#298).
 *
 * Each language is a lazy chunk, fetched only when chosen — and this worker otherwise caches only
 * what has been fetched, so a language never used online would be missing on a plane. The build
 * writes the chunk list to `/i18n-precache.json` (packages/shell/vite.config.ts); the names are
 * content-hashed, so they cannot be written here. Best-effort, one file at a time: a failure leaves
 * that language to be fetched on demand, as before, and never fails the install.
 */
function precacheCatalogs(cache) {
  return fetch("/i18n-precache.json", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : { files: [] }))
    .then(({ files }) =>
      Promise.all(
        (Array.isArray(files) ? files : []).map((url) =>
          fetch(url)
            .then((res) => (storable(res) ? cache.put(url, withoutVary(res)) : undefined))
            .catch(() => {}),
        ),
      ),
    )
    .catch(() => {});
}

// No cache is deleted here: the pages still open may be on the build before (see the header).
// Taking them over and asking each which build it runs is what lets `prune` decide.
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim().then(() => prune()));
});

/**
 * Cache a copy without letting a cache failure fail the response — and never cache a failure.
 *
 * `res.ok` is the main guard: a 401 from an auth gate, a 404 from a stale asset name, a 5xx from a
 * relay hiccup are all answers that must not outlive the moment. An auth failure additionally
 * evicts any older copy, so recovering is a reload rather than "clear all site data".
 */
function stash(req, res) {
  if (res.status === 401 || res.status === 403) {
    caches
      .open(CACHE)
      .then((c) => c.delete(req))
      .catch(() => {});
    return res;
  }
  // `type: "opaque"` is a cross-origin response we cannot inspect; `ok` is false for it, which is
  // the conservative answer. And `no-store` means what it says.
  if (!storable(res)) return res;
  // The face finder's runtime and model (docs/25 §Faces) are versioned in their path and the same for
  // every origin; the runtime's loader is a module script, asked for with an `Origin` header, so a
  // `Vary: Origin` kept on the copy would make it miss offline (see `withoutVary`).
  const copy = new URL(req.url).pathname.includes("/potyro-faces/") ? withoutVary(res.clone()) : res.clone();
  caches
    .open(CACHE)
    .then((c) => c.put(req, copy))
    .catch(() => {});
  return res;
}

/** Marker for the one automatic retry, so a gate that keeps refusing cannot spin. */
const RETRY_MARK = "/__potyro_auth_retry";

/**
 * An auth challenge the worker cannot answer: hand the navigation back to the browser.
 *
 * `fetch` inside a worker has no way to ask anyone for a password, so a 401 arrives as data and
 * whatever we return is what the person reads — Apache's "Unauthorized" page, with no prompt and no
 * way forward except deleting the site's data. Unregistering means the NEXT navigation is performed
 * by the browser itself, which does know how to ask; a one-shot reload gets there without anyone
 * having to know that.
 *
 * Once. A gate that refuses the credentials as well would otherwise reload for ever, so the second
 * time within the minute this says what happened and offers the reload as a button instead.
 */
async function stepAside(req) {
  const cache = await caches.open(CACHE);
  await cache.delete(req).catch(() => {});
  await cache.delete(shellKey(req)).catch(() => {});
  const seen = await cache.match(RETRY_MARK);
  const recent = seen ? Date.now() - Number(await seen.text()) < 60_000 : false;
  await cache.put(RETRY_MARK, new Response(String(Date.now()))).catch(() => {});
  // Let go of every page, not only this one: they are all behind the same gate.
  await self.registration.unregister().catch(() => {});
  const body = recent
    ? `<!doctype html><meta charset="utf-8"><title>Password needed</title>
       <body style="font:16px system-ui;margin:3rem auto;max-width:28rem;color:#241">
       <h1 style="font-size:1.25rem">This site needs a password</h1>
       <p>Your browser was not able to sign in. Reload and enter it when asked.</p>
       <p><button onclick="location.reload()" style="font:inherit;padding:.5rem 1rem">Reload</button></p>`
    : `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0">
       <title>Signing in…</title><body style="font:16px system-ui;margin:3rem">Signing in…`;
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** Where the page is kept, as an absolute URL beside the request's own. */
function shellKey(req) {
  return new URL(SHELL, req.url).href;
}

/**
 * A navigation answered by the network: keep it as THE page when it is the page (any route of `/`)
 * and this build's, with its files here. Another path is answered and not kept.
 */
function keepNavigation(req, res) {
  const path = new URL(req.url).pathname;
  if ((path === "/" || path === "/index.html") && storable(res)) {
    const copy = res.clone();
    caches
      .open(CACHE)
      .then(async (cache) => {
        const list = await ownList(cache);
        if (!(await isOwnPage(copy, list)) || !(await bootKept(cache, list))) return;
        await cache.put(shellKey(req), copy);
      })
      .catch(() => {});
  }
  return res;
}

/** Offline: this build's page for every navigation; an older build's only if this one has none. */
function shellCopy(req) {
  return caches
    .open(CACHE)
    .then((cache) => cache.match(shellKey(req)))
    .then((hit) => hit || caches.match(shellKey(req)));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Straight to the network, as if there were no worker: nothing of it is kept.
  if (bypassed(req)) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => (res.status === 401 || res.status === 403 ? stepAside(req) : keepNavigation(req, res)))
        .catch(() => shellCopy(req)),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => stash(req, res))
          .catch(() => shellCopy(req)),
    ),
  );
});
