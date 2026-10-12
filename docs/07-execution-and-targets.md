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

### Libraries and an app's own modules (#266, #258)

- **An app's own modules** (#258, "option B"): the entry file (`app.tsx`) stays the one editable
  source — History, diffs, the Studio editor, Ask's edits and sync are unchanged. What it imports
  relatively (`./plan.js`) comes from the package's `src/`, which `pnpm pack:app` fills by following
  the entry's imports (an import that leaves the source's folder is refused). At install the modules
  are kept in the app's space under `.src/`. They are not versioned: restoring an older entry keeps
  the modules the app has now.
- **Libraries** (#266) are imported by URL, pinned to an exact version:
  `import Chart from "https://esm.sh/chart.js@4.4.1?bundle"`. URL imports only — no bare npm names.
  A package may carry `lock.json` (`url → { file: ".modules/<sha256>.js", integrity: "sha256-…",
  size }`) and the bytes under `files/.modules/`; otherwise the card says what will be fetched
  ("fetches chart.js 4.4.1 from esm.sh") and the fetch happens host-side, once,
  when the person presses Add — never to draw the card, never at run time (rule 6). The fetch follows
  the library's **whole import graph** (absolute and relative paths, literal dynamic imports) and
  locks every file, or refuses by the library's name: a URL without an exact version, a file the
  host does not serve, a bare package name inside a library, an `import()` of a value decided at run
  time, a file loaded beside itself (`import.meta.url`). Nothing half-locked is kept. A library that
  only *mentions* `require` (a browserify prelude's `typeof require == "function" && require`, as in
  p5 1.x) is not refused: a browser has no `require`, so that code loads nothing, online or off.
  Tested against the real esm.sh by `e2e/mood-sleep-trusted.spec.ts` (chart.js 4.5.1) and
  `e2e/photo-garden-trusted.spec.ts` (p5 1.11.11); the demo apps are in `apps/`.
- **The lock lives on the app's record** (`UserApp.lock`, beside its source), not in its synced file
  space: someone sharing the app must not be able to change code that runs here by changing a file.
  `.modules/` and `.src/` are hidden from `ctx.files` and cannot be written by the app.
- **One bundler plugin, both trust levels** (`shell/src/package-modules.ts`): `bundleAppSource`
  (isolate IIFE) and `bundleTrustedModule` (trusted ESM) read each file through the Store and check
  its digest first. A mismatch refuses to bundle — "chart.js 4.4.1 is not the copy this app was
  installed with" — and the app shows that on its splash instead of opening.
- **Libraries in the sealed box** are just more code inside the isolate (no DOM, no `fetch`). One
  that touches `window`/`document` while loading fails with its own name: "chart.js 4.4.1 needs a
  full web page to work … this app can only run as yours". The card says so when the bytes came with
  the package; when they were fetched at install, the dialog says it right after.
- **History**: each version carries the libraries part of the lock as `lock.json` text; an upgrade is
  a version with a `lock.json` diff, and Restore brings its libraries back (their old bytes stay on
  the device, so offline), keeping the ones the app has now under them for its current modules.
- **A Studio save** of a version that imports a library the app does not have yet says what it
  fetches first, and fetches it with consent when the version is saved — for code a person writes by
  hand. **Not yet** (owner decision): the Studio's model and the generator prompt are not taught to
  use libraries; that waits on a paid measurement the owner approves.

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
