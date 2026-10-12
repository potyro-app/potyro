# 07 · Execution, Trust & Targets

App logic is full JavaScript. Safety comes from **where the code runs** and **what `ctx.caps`
it's handed** — chosen by the app's **provenance**, not by restricting the language.

## Provenance → execution mode

The `host` package (WP2) tags every loaded app as **trusted** or **untrusted** and picks a
runner accordingly.

| provenance | example | runner | `ctx.caps` |
|---|---|---|---|
| **trusted** | app in your own workspace dir; app you authored/promoted | **direct**: real import / dynamic `import()` in the host (main thread or worker), full language, real modules | all real, unmediated, no prompts |
| **untrusted** | app imported via share-sheet, URL, or received file, not yet promoted | **isolated**: bundled and run in a **QuickJS-WASM** isolate | denied by default; each declared permission granted only after a user consent prompt, then handed a **mediated** wrapper |

The user can inspect an untrusted app's source and **promote** it to trusted (then it runs
direct, full authority) — same mental model as trusting a browser extension or a userscript.
Promotion is explicit and revocable.

## Why QuickJS-WASM for the untrusted runner

- **Identical semantics on web and native.** The same isolate runs in the PWA and inside the
  Capacitor app — no per-target sandbox divergence.
- **No ambient authority.** The isolate has no `fetch`, `window`, DOM, filesystem, or storage
  unless the host explicitly injects a function. `ctx` is the *only* bridge in.
- **Hard limits.** Memory ceiling and execution timeout per call; a runaway or malicious app
  is bounded, not fatal.
- **Real JavaScript.** Full language inside the box — loops, closures, classes, the app's own
  bundled helpers. Nothing about the *language* is reduced; only *authority* is.

Trusted apps **skip the isolate entirely** — native speed, real imports, native modules. You
don't pay sandbox cost for your own code. (On web, a trusted app may still run in a Worker for
UI responsiveness; that's a performance choice, not a trust boundary.)

## The `ctx` mediation layer (untrusted apps)

For untrusted apps the host builds a `ctx` whose non-cap members (data, time, storage, ui,
nav) are real but **namespaced to the app** (its own Store namespace, its own kv, its own
media area), and whose `caps` are:

- **absent** unless the app's `permissions` manifest requests them,
- **prompted** on first use (or at install) with a clear description,
- **wrapped** when granted — e.g. `network.fetch` may be restricted to an allow-list of hosts,
  `filesystem` to an app-private folder, `notifications` rate-limited. App code sees the
  standard `ctx.caps.*` interface; the wrapper enforces scope.

`permissions.sync` is the odd one out, and deliberately so: sync is not a call app code makes, it is
a STORE the composition root does or does not open. So the shell asks (once per app, before an
untrusted app first syncs — sharing, or turning sync on) rather than the mediation layer prompting on
first use, and a refusal simply opens the local store: the app keeps working, on this device only.
Joining a shared link is itself the consent, and the join dialog says what syncing means. Declaring
`sync` in the manifest changes what the question says, not whether it is asked (KA-23).

Data isolation: an untrusted app can never read another app's records — the `Store` is opened
per app id, and the isolate only receives a `ctx` bound to that app's store.

## Distribution: what a shareable app is

- A `*.app.ts` module is **bundled** (esbuild) to a single self-contained `*.app.js` (plus an
  optional assets folder). That bundle is the shareable artifact.
- The bundle carries the `permissions` manifest and metadata; the receiving shell shows it
  before running, runs it **untrusted** by default, and offers "inspect source / promote".
- Honest tradeoff (accepted): a code bundle is less trivially inspectable than a data file and
  *always* means running code — so the trust prompt for untrusted apps is not optional, it is
  the whole safety story. This is the price of full control, and it's the right price.

### Packages and Add an app (#253)

- **A package** is a zip: `app.ts`/`app.tsx`, `files/…` it ships with, an optional `seed.json`
  (`{ entity: [records] }`) and a `manifest.json` (`potyro-app/1`). A bare source is a package with
  no files; an export bundle installs as one too. `pnpm pack:app <app.tsx> [file …] [--files dir]
  [--seed seed.json]` makes one.
- **Add an app** (launcher) takes a package or the app's file with the files it uses from this
  device, a link, or pasted source. It reads the app **in the sealed box** to show a card — name,
  what it keeps, what it asks for, what it ships — before anything is saved.
- **Trust at install** (owner, 2026-10-11): everything comes in **sealed**. For a file from this
  device or pasted source the card offers "I wrote this, run it as mine"; **a link never does**,
  and an update from a link drops a trusted app back into the sealed box, so a link cannot put new
  code into an app that runs with full authority. An update from a file or paste keeps the trust the
  app had.
- **The same app already installed**: *Replace, keep its data* is preselected — the ordinary update
  path, so History keeps the old version and the data check runs on the next open. Shipped files are
  replaced unless the person changed them (they are then `app`, not `shipped`) and kept; shipped files
  the new version dropped are removed. The seed never runs on an update. *Add as a second app* makes
  an empty copy under a new id.
- **How it was made** (#261): a package or an export bundle may carry `chat.json` — the Studio
  conversation that made the app (`potyro-chat/1`: what was asked, the agent's questions and answers,
  a line per version). It goes in only when the person answers yes to "Include how this app was
  made?" on Export; on a first install it becomes the app's conversation, ending with a line that
  says it came from the author. An update never overwrites the conversation the receiver has had
  since, and anything in `chat.json` that is not a conversation is ignored, never fatal.
- **Install links**: `https://<shell>/#add=<url-encoded link>` opens the dialog with the link filled in.

## Authoring loop (offline)

- **Trusted dev:** `pnpm dev` loads `examples/*.app.ts` directly via Vite; edit + hot-reload,
  full debugging, real breakpoints. No isolate in the way.
- **Sandbox check:** `pnpm dev:sandbox` bundles an app and runs it untrusted in QuickJS-WASM so
  you can feel the mediated-caps experience a recipient would get.
- All authoring works offline; bundling is local (esbuild in-process / WASM).

## Targets

### PWA (first)
Vite build + cache-first service worker. Persistence via OPFS SQLite. `WebCapabilities` backs
`ctx.caps`. Trusted apps run direct (main/worker); untrusted in QuickJS-WASM (WASM runs fine in
the browser).

### Capacitor (second)
Wraps the same web build. `CapacitorCapabilities` backs `ctx.caps` with real native camera,
**exact local notifications**, geolocation, filesystem. Same two runners. Added via
`npx cap add`; only the composition root changes.

## Capability matrix (unchanged truths)

| capability | Web (PWA) | Capacitor (native) | note |
|---|---|---|---|
| camera / photos | getUserMedia / input capture | @capacitor/camera | both fine |
| filesystem | File System Access / download | @capacitor/filesystem | native nicer for share-sheet |
| geolocation | navigator.geolocation | @capacitor/geolocation | both fine |
| **notifications** | web push (installed PWA only), no reliable exact local schedule | @capacitor/local-notifications — real offline exact schedule | **deciding feature** |
| haptics | navigator.vibrate | @capacitor/haptics | non-sensitive; manifest-gated, no prompt |
| network | fetch (gated via ctx.caps.network) | native http/fetch | gated for untrusted apps |
| map tiles | online, or cache a region | same + native caching | offline maps need cached tiles |

### Notifications & maps
Same design as before: on native, schedule exact local notifications (offline). On web,
degrade to prominent in-app "due" state, with optional Web Push only if the user self-hosts a
tiny relay. Map tiles: online by default; optional per-region offline caching later.

## App Store note

Your published shell app embeds a JS engine that runs app logic — that's a scripting host /
browser pattern, which is permitted. Shared apps run **sandboxed and non-native**; you never
download and execute *native* code. Keep it that way and you stay compliant while app logic
remains full JavaScript.
