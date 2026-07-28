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
// CACHE is versioned: bump it on release and `activate` drops every older cache.

const CACHE = "karta-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.add("/")));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Cache a copy without letting a cache failure fail the response. */
function stash(req, res) {
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
