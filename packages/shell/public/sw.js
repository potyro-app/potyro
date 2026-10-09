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
// A 401 on a NAVIGATION is handled differently again: the worker gets out of the way entirely. The
// browser only shows its password box for a navigation IT performs, and a worker-handled navigation
// is not one — so behind a basic-auth gate the worker turns "ask me for the password" into "here is
// the server's error page", intermittently, whenever the browser has forgotten the credentials it
// was silently attaching. See `stepAside` below.
//
// CACHE is versioned: bump it on release and `activate` drops every older cache. It is bumped here
// deliberately, so a browser still holding a poisoned v2 throws it away on the next load.

const CACHE = "potyro-v4";

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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => (res.status === 401 || res.status === 403 ? stepAside(req) : stash(req, res)))
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
