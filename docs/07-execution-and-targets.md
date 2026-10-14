# 07 · Execution, Trust & Targets

App logic is full JavaScript. Safety comes from **where the code runs** and **what `ctx.caps`
it's handed** — chosen by the app's **provenance**, not by restricting the language.

## Provenance → execution mode

The `host` package (WP2) tags every loaded app as **trusted** or **untrusted** and picks a
runner accordingly.

| provenance | example | runner | `ctx.caps` |
|---|---|---|---|
| **trusted** | app in your own workspace dir; app you authored/promoted | **direct**: real import / dynamic `import()` in the host (main thread or worker), full language, real modules | all real, unmediated, no prompts |
| **untrusted** | app imported via share-sheet, URL, or received file, not yet promoted | **sealed**: bundled, and its logic run in a **browser realm** — a Worker inside an opaque-origin sandboxed iframe — reached only through the mediated `ctx` (#272; the QuickJS-WASM isolate is the fallback, behind a flag) | denied by default; each declared permission granted only after a user consent prompt, then handed a **mediated** wrapper |

The user can inspect an untrusted app's source and **promote** it to trusted (then it runs
direct, full authority) — same mental model as trusting a browser extension or a userscript.
Promotion is explicit and revocable.

## Why a browser realm for the untrusted runner (#272)

Measured in docs/22 (Chromium with and without site isolation, Firefox with and without Fission,
WebKit), and shipped for shared apps' **logic** on 2026-10-14 (phase 1). Custom views of shared apps
stay off, as before; the view phase waits for the Android WebView probe (docs/22 §5).

```
 shell page ── createSharedAppLoader → createRealmLoader(frameSpawner()) ── LoadedApp.call*(…, ctx)
   │  ctx = buildCtx(): mediateCaps, values gate, authorship — the same object a trusted app holds
   │  RealmLoadedApp: op allow-list (OPS) + issued ctx ids → ctx.<method>(…); watchdog
   │        ▲ one MessagePort per app
   └────────┼──── <iframe sandbox="allow-scripts" srcdoc>   opaque origin, realm CSP, WebRTC deleted
            └───── Worker (blob:)  the app bundle (the same IIFE QuickJS ran) + DirectLoadedApp
```

- **A browser's own built-ins, sealed.** `Intl`, `URL`, `TextEncoder`, `crypto`, timers,
  `structuredClone`, `Intl.Segmenter`: a shared app behaves as it would in the person's own browser.
  Through QuickJS the same app's computed values came back empty (docs/22 §2). What a Worker still
  lacks is a page — `window`, `document` — so a library that touches one while it loads fails as
  before, and the card says so (`missing-features.ts`).
- **No ambient authority.** The frame's sandbox is `allow-scripts` and nothing else, so its origin
  is opaque: no cookies, no storage of the shell's, no parent DOM, no popups, no top navigation, no
  forms. Its CSP — `default-src 'none'; connect-src 'none'; …` (`REALM_CSP`, `host/src/realm/
  protocol.ts`) — lets nothing load from a URL and nothing connect; the Worker inherits both. `ctx`
  is the only bridge: every op the realm sends is checked against a fixed list and a ctx id the
  host issued, and is then the very method call a trusted app makes, on the ctx `buildCtx` built —
  `mediateCaps`, the values gate and authorship are not repeated anywhere, so they cannot drift.
- **Two holes CSP leaves, closed** (docs/22 §3.2). WebRTC: CSP does not govern ICE and no engine
  honours `webrtc 'block'`, so the frame deletes the RTC constructors before anything runs (a Worker
  never has them). Self-navigation: the sandbox lets the frame navigate itself and its own CSP
  cannot stop it, so **the shell is served with `frame-src 'none'`** — a `<meta>` in
  `shell/index.html` (all the Capacitor WebView gets), and the same policy as a header from the dev
  server and `vite preview` (`shell/vite.config.ts`) and Apache (`deploy/apps.vaz.io.conf`). A
  srcdoc is not a fetch, so the realm still loads. `e2e/shell-csp-*.spec.ts` checks it where it is
  served, with a control page that has no policy.
- **Limits, by a watchdog** (`RealmLoadedApp`). Each call has a deadline (1 s, paused while a
  question, a consent prompt, a dialog or a fetch waits on the person or the world); the Worker beats
  every 100 ms and a second of silence stops it; a realm that floods the host with messages is
  stopped too. A stop removes the frame, which ends its Worker, rejects what was waiting with the
  reason, and the next call starts a fresh realm (40–60 ms). Logic in a loop is stopped in about a
  second in every engine, and the shell's own thread never stalls (`e2e/realm-escape-sandbox.spec.ts`).
- **Real JavaScript, and faster.** Full language and the browser's built-ins; `ctx.query` crosses
  1.4–4.7× faster than through QuickJS, and formatting no longer crosses at all (docs/22 §6).

What is lost against QuickJS, and how it is answered (docs/22 §7):

| QuickJS gave | The realm | Answer |
|---|---|---|
| A memory cap (claimed 64 MB) | None per Worker | The cap never held as shipped (docs/22 §6.1). Cap what crosses `ctx`; process isolation where the engine has it. |
| Interrupting one call, keeping the VM | The whole realm stops after ≤ 1 s of silence | App state lives in the Store, so a stop loses a cache; the next call restarts it. |
| Pre-empting any code | Logic: yes, by ending its thread. Views: only where the frame is out of process | Views of shared apps stay off (phase 3 decides). |
| The same semantics everywhere | The engine's own built-ins and ICU data | The point of #272: an app behaves as in the person's browser. Formatting is still `format.ts` at both provenances. |
| No WebRTC, no navigation, by construction | Both exist in the frame | Deleted, and `frame-src 'none'` (above). |

**The QuickJS fallback** stays until the owner removes it (docs/22 §8 phase 4). It runs when
`localStorage["potyro:sandbox"] = "quickjs"` on a device, when the shell is built with
`VITE_POTYRO_SANDBOX=quickjs`, under `pnpm dev:sandbox:quickjs`, wherever no realm can be built (no
Worker, no DOM: the Node tests), and for the rest of a session in which the realm would not start
(`RealmStartError`: the box failed, not the app). Either way the app is sealed. Verification and the
Studio's checks still run candidates in QuickJS until phase 2 moves them.

Trusted apps **skip the sealed box entirely** — native speed, real imports, native modules. You
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
per app id, and the realm (or the isolate) only receives a `ctx` bound to that app's store.

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
  device, a link, or pasted source. It shows a card — name, what it keeps, what it asks for, what it
  ships — before anything is saved.
- **The card never runs code** (#271). `pnpm pack:app`, and the Export bundle, write what the app
  declares into `manifest.json` as `app`: the definition with every function replaced by the
  sealed box's marker (`store/src/app-declaration.ts`). `pack:app` reads it where the author packs it,
  in Node, so a top level that needs `Intl` still declares itself. The card is drawn from that. A
  package without it (an older one, pasted source) is read in the sealed box instead; if that
  throws, the card still comes up and says the app could not be previewed — never "does not load".
  If the code, once loaded, names a different app than its declaration, it is not added.
- **A test load at install** (#271). Before the person confirms, the module and its libraries load in
  the sealed box the app will run in — the realm, or QuickJS behind the flag — on a throwaway store and the generator's smoke run puts sample records through its
  computed values, filters, actions and reminders (`shell/src/app-trial.ts`). A ReferenceError or
  TypeError on a global the box lacks is named in plain words on the card ("It uses a feature shared
  apps don't have yet: a full web page (document)", `missing-features.ts`; in QuickJS also the
  built-ins it lacks, such as `Intl`), with "Run it as my
  own app" beside it for a file or paste. An install link (`#add=`) goes through the same card and
  the same test load. (A `#join=` invite asks about trust before the app's code has arrived, so it
  cannot be tried first.)
- **Trust at install** (owner, 2026-10-11): everything comes in **sealed**. For a file from this
  device or pasted source the card offers "I wrote this, run it as mine"; **a link never does**,
  and an update from a link drops a trusted app back into the sealed box, so a link cannot put new
  code into an app that runs with full authority. An update from a file or paste keeps the trust the
  app had.
- **Promotion is always reachable after install** (owner, 2026-10-13). The rule above is about the
  way IN; once an app is here, there is always a way to let it run as yours, whatever state it is
  in — one dialog (`trust-dialog.tsx`), one warning, reachable by mouse, touch and keyboard, and it
  only ever acts when the person confirms it. It is offered from: the 🛡 badge of an open sealed
  app; a sealed custom screen's "Run it as mine…"; the screen that says the app **could not open**,
  when the cause is the sealed box (a library that needs a full web page, or, in QuickJS, a feature
  it lacks such as `Intl` — `promotion.ts`); the Add-an-app card right after install, when the test load found it
  only works as yours ("It only works when it runs as yours … Otherwise it stays sealed"); the
  app's tile menu on your apps ("Let it run as yours") — there even when the app crashes at boot;
  and the Studio, which previews a sealed app **sealed** (opening it there is not saying it is
  yours) with "Let it run as yours" on its bar. Confirmed, the app reopens as trusted.
  A link is still never trusted on the way in. **A failure promoting does not fix never offers it**:
  code that does not compile, the app's own mistake, and above all a library or module that does
  not match its lock — tampered code must never be one tap from full authority. Such an app can
  still be promoted deliberately from its tile, and its trusted load refuses the mismatched bytes
  all the same.
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
- **Libraries in the sealed box** are just more code in the realm's Worker (no DOM; `fetch` refused by
  its CSP), or in the isolate behind the flag. One
  that touches `window`/`document` while loading fails with its own name: "chart.js 4.4.1 needs a
  full web page to work … this app can only run as yours". The card says so when the bytes came with
  the package; when they were fetched at install, the dialog says it right after.
- **The Studio's checks stand libraries in.** Checking or running a candidate change — the modify
  loop's check, run and shape gates, the Fix agent's verification, Edit mode's save check — happens in
  the sealed box on purpose (still QuickJS until docs/22 phase 2 moves verification to the realm), so a library that needs a full web page would fail the app as the person
  has it, and no change to it could pass. There every library the lock names loads as an inert
  stand-in (`withLibrariesStoodIn`), the same for the original and the candidate; the app's own
  modules stay real, a library the lock does not name is still refused, and the run says which
  libraries it stood in for. Opening, saving and installing the app still run and check the real ones.
- **History**: each version carries the libraries part of the lock as `lock.json` text; an upgrade is
  a version with a `lock.json` diff, and Restore brings its libraries back (their old bytes stay on
  the device, so offline), keeping the ones the app has now under them for its current modules.
- **Export bundles carry the code** (#282): Export writes the app's lock as `lock.json` — its
  libraries and, unlike a package's, its own modules too (`src/<path> → { file: ".src/<path>", … }`)
  — with the bytes under `files/.modules/` and `src/`, as a package carries them; `data.sqlite` holds
  only the app's data. Adding the app from the bundle goes through the package install and fetches
  nothing, so a backup restores with no network. A file the bundle (or any package) carries that is
  not what its lock says is a problem on the card, by name — "fancy-sum 1.2.3 is not the copy this
  app was saved with" — and the app is not added; it is never fetched again in its place. A data
  Import leaves the app's own code alone. Tested by `e2e/export-libraries-trusted.spec.ts`.
- **Shared by link or from the account, the lock travels with the source** (#281). The published
  app in the shared space (`app-sync.ts`, kv `__appSource`) and the app's entry on your account
  (`account-apps.ts`) each gain two additive fields (`store/src/carried-code.ts`): `lock` — the
  whole lock, libraries by URL and modules by `src/<path>` — and `modules` — the app's own modules,
  `src/<path> → text`. Older clients ignore both; a record without them reads as an app with no code
  beyond its source, and a malformed lock is dropped, never the app. **Library bytes do not
  travel**: the receiver, the first time the app opens there, is asked in the card's words ("It
  fetches fancy-sum 1.2.3, 2 KB, from esm.sh, once.") and fetches each library once, host-side,
  through the same walk as Add an app, every file checked against the lock that came with the app.
  An address no longer serving the locked bytes is refused by the library's name on the app's splash,
  and nothing is kept. "Not now" fetches nothing and the app says what it is waiting for; opening it
  again asks again. An app from a client that sent no lock has its libraries fetched fresh, with the
  same consent, and locked on that device (as a package without `lock.json` is). A collaborator's
  update that changes only a library is offered as an update, and taking it fetches the new bytes
  on the next open. **The app's own modules travel with the source**, not through a fetch: they
  have no upstream to fetch from, they are part of the app's code exactly as its source is (an edit
  may change both, and carried in the same record a new source never arrives ahead of the module it
  imports), and they are a few KB. They are checked against the lock on arrival and refused by name
  ("Its file plan.ts is not the copy this app was saved with") like every other byte of code.
- **An app's code lives in its local store** (`user:<id>` with sync off), whether or not its data
  syncs (`shell/src/app-modules.ts`): turning sync on leaves `.modules/` and `.src/` where they are
  rather than copying megabytes into the space, an install or Studio save into a synced app keeps
  them there too, and that is where a guest or another of your devices keeps what it fetched. Opening
  a synced app reads this device's copy first, then the space (code that reached it before #281).
  Tested by `e2e/share-libraries-trusted.spec.ts` (two and three browsers, esm.sh served from
  fixtures: opens after consent and then offline, a changed upstream file refused by name, a record
  without a lock still opens).
- **A Studio save** of a version that imports a library the app does not have yet says what it
  fetches first, and fetches it with consent when the version is saved — for code a person writes by
  hand. **Not yet** (owner decision): the Studio's model and the generator prompt are not taught to
  use libraries; that waits on a paid measurement the owner approves.

## Authoring loop (offline)

- **Trusted dev:** `pnpm dev` loads `examples/*.app.ts` directly via Vite; edit + hot-reload,
  full debugging, real breakpoints. No sealed box in the way.
- **Sandbox check:** `pnpm dev:sandbox` bundles an app and runs it untrusted in the browser realm so
  you can feel the mediated-caps experience a recipient would get; `pnpm dev:sandbox:quickjs` does
  the same in the QuickJS fallback.
- All authoring works offline; bundling is local (esbuild in-process / WASM).

## Targets

### PWA (first)
Vite build + cache-first service worker. Persistence via OPFS SQLite. `WebCapabilities` backs
`ctx.caps`. Trusted apps run direct (main/worker); untrusted apps' logic in the browser realm, served
with `frame-src 'none'` (QuickJS-WASM behind the flag).

### Capacitor (second)
Wraps the same web build. `CapacitorCapabilities` backs `ctx.caps` with real native camera,
**exact local notifications**, geolocation, filesystem. Same runners: the WebView builds the realm
from the same build, and gets the shell's `frame-src 'none'` from the `<meta>` in `index.html`, since a
Capacitor WebView serves no headers. Whether a view in a sandboxed frame there can freeze the shell
is what the Android probe measures (docs/22 §5) before views of shared apps are planned. Added via
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

Your published shell app runs app logic in the WebView's own JavaScript engine, sandboxed (and can
embed QuickJS-WASM as the fallback) — that's a scripting host / browser pattern, which is permitted. Shared apps run **sandboxed and non-native**; you never
download and execute *native* code. Keep it that way and you stay compliant while app logic
remains full JavaScript.
