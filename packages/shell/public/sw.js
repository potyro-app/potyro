// Offline-first service worker for the PWA target (docs/07). PRODUCTION ONLY — main.tsx refuses to
// register this in dev and tears down any existing registration, because a cache-first SW makes
// every edit invisible until the cache happens to miss.
//
// Strategy differs by request kind, which the previous cache-first-for-everything version got wrong:
//   navigations     → NETWORK FIRST, cache as fallback. A stale document replays an old app build.
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
// CACHE is versioned: bump it on release and `activate` drops every older cache. It is bumped here
// deliberately, so a browser still holding a poisoned v2 throws it away on the next load.

const CACHE = "karta-v3";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Pre-caching the shell is an optimisation, not a precondition: `cache.add` REJECTS on a non-2xx,
  // so behind an auth gate a single 401 here would fail the whole install and leave the previous
  // worker in place indefinitely.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add("/"))
      .catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Cache a copy without letting a cache failure fail the response — and never cache a failure.
 *
 * `res.ok` is the whole guard: a 401 from an auth gate, a 404 from a stale asset name, a 5xx from a
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
  // the conservative answer.
  if (!res.ok) return res;
  const copy = res.clone();
  caches
    .open(CACHE)
    .then((c) => c.put(req, copy))
    .catch(() => {});
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => stash(req, res))
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => stash(req, res))
          .catch(() => caches.match("/")),
    ),
  );
});
