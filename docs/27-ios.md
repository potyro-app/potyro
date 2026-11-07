---
title: iOS
description: Potyro on iPhone through Capacitor: the handoff for the iOS developer.
status: current
order: 27
---

# 27 · iOS (Capacitor) — handoff for the iOS developer

Potyro on iPhone is the **same codebase** as the web app and the Android APK: Capacitor wraps the
shell's web build (`packages/shell/dist`) in a `WKWebView`, and the composition root swaps the web
capabilities for `CapacitorCapabilities` (`packages/native`). There is no Swift app to write. The
work is building and signing the generated Xcode project, adding a Share Extension, and checking on
a real phone what this document can only predict.

**Status (2026-10-15).** Nothing here has run on a Mac, a simulator or an iPhone. The codebase was
prepared on Linux. What *was* verified there: `pnpm cap:add:ios` generates the Xcode project (Capacitor
8.4.2, Swift Package Manager, all 9 plugins ship a `Package.swift`), `scripts/patch-plist.mjs`
patches it and parses back as a valid plist, a second sync changes nothing, and the TypeScript is
unit-tested. **Every Swift file is uncompiled.** Every iOS behaviour below is either cited from Apple,
WebKit or Capacitor sources or marked as a prediction. Please treat the checklist in §5 as the real
spec, and report what you find (§8).

Written for a competent iOS developer who has never seen Potyro. Background reading, in order of
use: [docs/13](13-native-android.md) (the same target on Android, with what was checked on a Pixel),
[docs/22](22-browser-realm-prototype.md) §10 (the sealed box), [docs/25](25-live-camera.md) (live
camera and faces).

---

## 0. What Potyro is, in one paragraph

People describe an app, or get one from someone, and Potyro runs it. An app is a TypeScript
module. Apps the person wrote themselves run **directly** in the shell's page. Apps from someone else
are **sealed**: their logic runs in a Worker inside an opaque-origin, sandboxed `<iframe>` with a
strict CSP, and reaches the device only through a mediated `ctx` over a `MessagePort`, behind
per-app permission prompts. All data is local first: one SQLite database (sqlite-wasm) on OPFS, in
a worker, with optional CRDT sync to a relay. The native shell exists for what the web cannot do
reliably, above all **exact reminders that fire with the app closed**.

---

## 1. Prerequisites

| | Version | Why |
|---|---|---|
| A Mac with **Xcode 26** | 26.0+ | "Capacitor 8 requires a minimum of Xcode 26.0" (Capacitor environment setup) |
| An **iPhone on iOS 17 or later** | 17.0 minimum | the deployment target the patch sets (§3 explains why 17) |
| An **Apple Developer Program** membership | paid | device signing beyond 7-day free profiles, App Groups for the Share Extension, TestFlight |
| **Node 22** | `>=22` | the Capacitor 8 CLI refuses older Node |
| **pnpm 10** | `10.5.0` | `corepack enable` picks the version in `package.json` |
| Safari on the Mac | any | Web Inspector into the app's WebView (Develop → *your iPhone* → Potyro) |

No CocoaPods: the generated project uses Swift Package Manager, and every plugin in use ships a
`Package.swift`.

## 2. Build and run

```bash
git clone https://github.com/potyro-app/potyro && cd potyro
pnpm i

# 1. The web build the app wraps. The native app is not served from the site, so tell it which site
#    is its own (packages/shell/src/site.ts): the sync relay, the AI and request services and the
#    links people send are derived from this. Leave it out for a fully local build.
VITE_POTYRO_SITE=https://potyro.app pnpm --filter @potyro/shell build:web

# 2. Generate the Xcode project (first time only) and patch it: Info.plist usage descriptions,
#    file sharing, the potyro:// scheme, "Open with", the deployment target, AppDelegate.
cd packages/native
pnpm cap:add:ios

# 3. Open it, set signing (§4.1), pick your iPhone, Run.
pnpm cap:open:ios
```

After every web change:

```bash
VITE_POTYRO_SITE=https://potyro.app pnpm --filter @potyro/shell build:web
pnpm --filter @potyro/native cap:sync:ios       # copies dist → ios/App/App/public and re-patches
```

Shortcut: `VITE_POTYRO_SITE=https://potyro.app pnpm --filter @potyro/native ios` (build, sync, open).

`ios/` is **generated and gitignored**, like `android/`. Do not commit it. Anything it needs that
Capacitor does not generate lives in a script (`scripts/patch-plist.mjs`, re-run by every
`cap:add:ios` / `cap:sync:ios`, idempotent, and it never overwrites a key you edited in Xcode) or a
template (`packages/native/ios-templates/`, copied in once by hand, §4). If you find yourself
changing something in `ios/` that must survive a fresh `cap add ios`, put it in the script and say
so in the PR.

### 2.1 Pointing it at potyro.app — and what will not work yet

`VITE_POTYRO_SITE` sets all of these at once; each can still be overridden on its own. potyro.app has
no basic-auth gate (the first site, apps.vaz.io, did, and is no longer updated: docs/16). What is
left is CORS: the WebView's origin (`capacitor://localhost` on iOS, `https://localhost` on Android)
is another origin than the site's. Checked against the code and the live site on 2026-10-30, not on
a device:

| Service | Derived address | Override | Works from the iOS app today? |
|---|---|---|---|
| Sync relay (websocket) | `wss://potyro.app/sync` | `VITE_POTYRO_RELAY` | **Not tried on a device.** The relay upgrades without credentials; a websocket is not subject to CORS |
| AI for apps | `https://potyro.app/ai` (`/complete`) | `VITE_POTYRO_AI` | **Yes** — the relay answers the WebViews' origins (`AI_CORS_ORIGINS`) with CORS, without credentials (docs/16 "AI for apps"). Its chat route, `/v1/chat/completions`, is not running there yet |
| Platform requests | `https://potyro.app/requests/…` | `VITE_POTYRO_REQUESTS` | **No** — the service sends no CORS headers (it assumes same origin) |
| Hosted demo links | `https://potyro.app/share-api` | `VITE_POTYRO_SHARE` | Falls back to an inline link: the share service sends no CORS headers either, so the health check fails |
| Invite and demo links people send | `https://potyro.app/#join=…` | — | The link is right; opening it in the app needs Universal Links (§9) |

The same is true of the Android build. Everything local works without any of it: apps, records,
reminders, camera, sharing between apps on the phone. AI also works with the person's own
OpenRouter key (Model settings), which is called directly and allows browser origins. Fixing the two
"No"s is an owner decision (§7, decision 1); do not work around it in the app.

## 3. The audit: what WKWebView changes, subsystem by subsystem

The WebView's origin is **`capacitor://localhost`** — Capacitor's `WKURLSchemeHandler` serves the
bundled `public/` folder, sends **no response headers** besides `Content-Type` and
`Cache-Control` (`WebViewAssetHandler.swift`), and answers any path that is not a file with
`index.html`. Everything below follows from that, and from WebKit being the only engine iOS allows.

### 3.1 Storage — SQLite on OPFS in a worker

What Potyro does: `packages/store/src/sqlite-worker.ts` installs sqlite-wasm's **`opfs-sahpool`**
VFS in a dedicated worker (sync access handles are worker-only by spec), one pool for every
database. A Web Lock (`navigator.locks`, `storage-owner.ts`, #336) makes one tab the owner. If the
worker cannot start, `open-store.ts` falls back to an IndexedDB copy rewritten on every save, then
to `localStorage`.

| Question | Answer | Evidence |
|---|---|---|
| Does the SAH-pool VFS need `SharedArrayBuffer` / COOP+COEP? | **No.** That is why it was chosen. The scheme handler cannot send COOP/COEP, so the other OPFS VFS (`opfs`) is impossible on iOS anyway. | sqlite.org/wasm "Persistent Storage Options"; Capacitor `WebViewAssetHandler.swift` |
| Which iOS has OPFS sync access handles? | Safari/WebKit **16.4+** for `opfs-sahpool`; WebKit < 17 had other OPFS bugs. Target is 17. | sqlite.org/wasm persistence doc; PowerSync "SQLite persistence on the web, May 2026" |
| Does OPFS work in a **WKWebView** (not Safari) on a custom scheme? | **Predicted yes, unverified.** Capacitor uses the default persistent `WKWebsiteDataStore`; reports of `getDirectory()` failing are for ephemeral/private stores. | Playwright #18235 (ephemeral WebKit context) |
| Do access handles survive the app going to the background? | **Unknown — the top storage risk.** PowerSync reports that on Capacitor *iOS*, OPFS access handles "can be closed when the app is in the background, causing errors when resuming" (seen with their OPFSCoopSyncVFS; the SAH pool holds handles for its whole life, so the same would bite harder). | powersync.com/blog/sqlite-persistence-on-the-web |
| Closing and reopening | iOS 26 has an open bug where a database closed by the worker calling `self.close()` cannot be reopened (`InvalidStateError`). Potyro uses `worker.terminate()`, the reported workaround. | bugs.webkit.org/show_bug.cgi?id=301520 |
| Web Locks | In WebKit since 15.4, including workers. With one WebView there is no second tab; the lock still guards a WebView reload. | `storage-owner.ts` notes; MDN |
| ITP's 7-day storage cap | **Does not apply.** It counts days of *Safari* use; a WKWebView app has its own counter, reset every launch. | WebKit "Full third-party cookie blocking and more" (2020); Thinktecture's ITP/WKWebView analysis |
| Eviction | WebKit evicts a whole origin, least recently used, under storage pressure or past quota (non-browser apps: 15% of disk per origin, 20% total). **`navigator.storage.persist()`** opts out; the app now asks for it on every native start (`packages/native/src/keep-storage.ts`). Whether WKWebView grants it to a non-browser app is unverified. | WebKit "Updates to Storage Policy" (2023) |
| Service worker | None on a custom scheme (WKWebView allows them only on app-bound https domains). `registerServiceWorker` already fails quietly; nothing depends on it in the app, whose files are local. | Capacitor issue #7069 |
| **Never change the origin** | Every database belongs to `capacitor://localhost`. Setting `server.hostname`, `server.url` or a different `iosScheme` after release moves the app to a new, empty origin: every app and record on every phone looks gone. `capacitor.config.ts` pins both schemes and a test holds them. A hostname with a port also costs the secure context (Capacitor #6759). | `capacitor.config.ts`, `test/patch-plist.test.ts` |

How to see what a phone ended up on: **You → storage report** in the app ("a database in a worker
(the fast one)" is right; "IndexedDB, rewritten whole on every save (slow)" means OPFS failed and
the fallback caught it). In Web Inspector: `await navigator.storage.persisted()`.

### 3.2 The sealed box — sandboxed iframe + Worker + CSP

What Potyro does (docs/22 §10): `<iframe sandbox="allow-scripts" srcdoc=…>` (opaque origin) with a
realm CSP; logic in a **`blob:` Worker** inside it; the shell's own `<meta http-equiv=CSP
content="frame-src 'none'">` stops that frame navigating anywhere. QuickJS-WASM is the fallback.

- **Measured in WebKit 26.5 (desktop, Linux, Playwright)**: the realm starts, a blob Worker runs in
  the opaque origin, every escape test fails as it should, and the `<meta>` alone (no headers, as on
  iOS) enforces `frame-src 'none'`. iOS WebKit is the same engine; the WebView is not, quite.
- **No site isolation in WebKit**: a sealed *view* that busy-loops freezes the shell's thread
  (docs/22 §4.2, same as desktop Safari). Logic in the Worker does not. Expected, not new.
- **Camera from inside the sealed frame**: Capacitor's `WebViewDelegationHandler` answers every
  `requestMediaCapturePermissionFor` with `.grant`, for any frame. What should stop a sealed frame
  calling `getUserMedia` itself is WebKit's Permissions Policy (a cross-origin frame without
  `allow="camera"` is refused before the delegate is asked). **Verify on the phone** (§5, item 6);
  if it is not refused, override that delegate method to deny any frame that is not the main frame.
- **Memory**: a Worker's memory is not capped (docs/22 §6.1). iOS kills the WebContent process
  under memory pressure; Capacitor then reloads the page (`webViewWebContentProcessDidTerminate`).
  The app comes back; whatever the sealed app was doing does not.
- **Fallback**: `localStorage["potyro:sandbox"] = "quickjs"` on the device (Web Inspector console),
  or `VITE_POTYRO_SANDBOX=quickjs` for the build. The realm probe from docs/22 §5
  (`docs/spikes/browser-realm/android/probe.js`) runs as-is: paste it into Web Inspector's console,
  then `await __realmProbe()`.

### 3.3 Capabilities

| Capability | iOS path | Risk | Evidence |
|---|---|---|---|
| **Exact reminders, app closed** | `@capacitor/local-notifications` → `UNUserNotificationCenter`, calendar trigger at `at`. Fires with the app closed or killed; `allowWhileIdle` is Android-only and ignored. | **iOS keeps only 64 pending notifications per app and drops the rest silently.** The reconciler schedules one per record per reminder, across every app. Now handled: on iOS the adapter keeps the **soonest 64** (`makeRoom`, `IOS_PENDING_LIMIT`, tested); a later one is scheduled again when its app next opens. | Apple developer forums thread 811171 (Apple engineer) |
| Notification permission | asked on the first schedule; no plist key | the person may refuse; then nothing fires (same as Android) | Capacitor local-notifications docs |
| Camera photo | `@capacitor/camera` `getPhoto({ source: CAMERA })`; library: `PHOTOS` uses the system picker, which needs no permission | needs `NSCameraUsageDescription` (or iOS **terminates** the app), photo-library keys too | Capacitor camera docs |
| **Live camera** | the WebView's own `getUserMedia` (docs/25). WKWebView has it since iOS 14.3; Capacitor grants the WebKit-level request; iOS asks once for the camera. `capacitor://localhost` is a secure context. | broken on iOS 15.5–16.x with a hostname that has a port (Capacitor #6759, fixed in 17); `playsinline` is needed on the `<video>` — Capacitor sets `allowsInlineMediaPlayback = true`. Backgrounding stops the stream (as on Android). | Capacitor #6759; `CAPBridgeViewController.swift` |
| **Faces** (Mirror Monsters) | MediaPipe FaceLandmarker (wasm) in a worker, GPU delegate on an `OffscreenCanvas` WebGL2 context, falls back to CPU by itself (`faces-worker.ts`) | WebGL in `OffscreenCanvas` in a worker needs **iOS 17+**; on CPU it may be slow on older phones | MDN browser-compat-data #21127; WebKit STP 185 notes |
| Location | `@capacitor/geolocation` | needs both location keys; Potyro never asks for "always" | Capacitor geolocation docs |
| Haptics | `@capacitor/haptics` `vibrate` | iOS has no arbitrary vibration pattern; the first duration is used | — |
| Export a file | `@capacitor/filesystem` → app's Documents; visible in **Files → On My iPhone → Potyro** thanks to `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` | a share sheet would be the iOS way (§9) | Capacitor filesystem docs |
| **Share into Potyro** | `@capgo/capacitor-share-target` 8.0.54: a **Share Extension you add** writes to an App Group; the plugin reads it on launch, on `potyro://share` and on becoming active | the whole extension is manual and uncompiled (§4.4) | the plugin's README and iOS source |
| **Open with Potyro** | `CFBundleDocumentTypes` (`public.data`); `@capacitor/app` reports the `file://` URL; the AppDelegate patch copies an in-place (security-scoped) file into tmp first so the WebView can read it | uncompiled Swift; files from iCloud Drive not yet downloaded | Apple `startAccessingSecurityScopedResource` docs |
| Import an app file | the WebView's `<input type=file>`: iOS offers Photos / Camera / Files | none expected | — |
| Keychain secrets | `capacitor-secure-storage-plugin` 0.13 → iOS Keychain | none expected | its `Package.swift` |
| Network for apps / Ask sources | `fetch` (CORS applies, origin `capacitor://localhost`) / `CapacitorHttp` for Ask's sources (no CORS) | as on Android | `native-http.ts` |
| WebSocket (sync, and the rooms relay of docs/26 when it lands) | WebKit's own; `Origin: capacitor://localhost` | a relay that checks `Origin` must allow it; the basic-auth gate (§2.1) | — |
| Language | `@capacitor/device` `getLanguageTag()` | none expected | — |
| Full screen | Capacitor 8 `SystemBars` hides the status bar; there is no back button — the ✕ and Escape remain | none expected | `immersive.ts` |

## 4. One-time Xcode setup

### 4.1 Signing

Open `ios/App/App.xcodeproj` (`pnpm cap:open:ios`). Target **App** → Signing & Capabilities →
Team: your team, *Automatically manage signing*. Bundle identifier: **`app.potyro`** (the
`appId`; if the owner's team cannot register it, use another and tell the owner — it is also in
`capacitor.config.ts`). Deployment target shows 17.0 (patched).

### 4.2 Debugging

Debug builds have the WebView inspectable (`isInspectable`, Capacitor sets it in debug). On the
Mac: Safari → Develop → your iPhone → Potyro. Console, network, storage and the realm probe all
work from there. `print` from Swift and Capacitor's `⚡️` lines are in Xcode's console.

### 4.3 App Group

Target **App** → + Capability → **App Groups** → `group.app.potyro` (this exact string is
`IOS_APP_GROUP` in `capacitor.config.ts` and `appGroupId` in the share template; a test keeps them
equal).

### 4.4 Share Extension ("Add to Potyro")

1. File → New → Target → **Share Extension**, name `ShareExtension`, embed in App. Activate the
   scheme if asked.
2. Replace its `ShareViewController.swift` with
   `packages/native/ios-templates/ShareExtension/ShareViewController.swift`.
3. Delete its `MainInterface.storyboard`, and replace the `NSExtension` dictionary in its Info.plist
   with the one in `ios-templates/ShareExtension/NSExtension.plist` (principal class, no storyboard,
   activation rule: text, one web link, up to 20 images / movies / files).
4. ShareExtension target → + Capability → App Groups → the same `group.app.potyro`.
5. Deployment target 17.0 for the extension too.

Contract (from the plugin's iOS source): the extension writes `{ title, texts: [String], files:
[{ uri, name, mimeType }] }` to `UserDefaults(suiteName: "group.app.potyro")` under
`"share-target-data"`, copies each file into the group container first (the provider's copy is
deleted when its handler returns), then tries to open `potyro://share` (registered by the plist
patch). iOS may refuse to let an extension open its app; the share is then picked up the next time
Potyro becomes active. The app side is unchanged from Android: `filesOfShare` → `readSharedFile`
(`packages/native/src/share-target.ts`) through `Capacitor.convertFileSrc`.

### 4.5 "Open with Potyro"

Nothing to do: the plist patch declares the document types and patches `AppDelegate.swift`
(`potyroReadableCopy`). If a future Capacitor template changes that file, the patch says so instead
of guessing; apply the same three lines by hand.

### 4.6 Privacy manifest

Add `packages/native/ios-templates/PrivacyInfo.xcprivacy` to the App target (and a copy to the
extension). It declares UserDefaults (CA92.1, 1C8F.1) and file timestamps (C617.1). Each plugin ships
its own manifest for the APIs it calls. Check the merged report in Xcode's archive (Generate
Privacy Report) before the first upload.

### 4.7 Voice input (optional, docs/29)

The app already listens through the WebView's own speech recognition (Apple's), with
`NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` added by `patch-plist.mjs`.
For on-device recognition where iOS supports it (`requiresOnDeviceRecognition`), add
`packages/native/ios-templates/SpeechPlugin.swift` to the App target and register it in a
`CAPBridgeViewController` subclass (`bridge?.registerPluginInstance(SpeechPlugin())` in
`capacitorDidLoad()`). The JS side uses it as soon as `Capacitor.isPluginAvailable("PotyroSpeech")`
says so. **Uncompiled** — check: the Studio's microphone strip says "On this device" for English.

## 5. Device checklist

What the owner checked on Android (docs/13), plus what only iOS can break. Use a **debug build on
a real iPhone** (the simulator has no camera, and its notifications and storage differ). Note the
iOS version and the model with every result.

| # | Do | Expect | If not |
|---|---|---|---|
| 1 | Install, open | Boots to the launcher, no white screen, nothing under the notch or the home indicator | Web Inspector console; screenshot |
| 2 | You → **storage report** → run it | Mode: "a database in a worker (the fast one)"; writes in single-digit ms | Mode is IndexedDB → OPFS failed on WKWebView (risk R1): copy the console |
| 3 | Add a record in two different apps. **Swipe the app away** (kill it), reopen | Both records there. Web Inspector: `await navigator.storage.persisted()` → `true` | Data gone → critical, stop and report |
| 4 | With a record just added, press Home, wait **10+ minutes** (lock the phone), come back, add another record, kill, reopen | Both there; no error in the console | `InvalidStateError` / "access handle" errors on resume → risk R2 |
| 5 | Open a **sealed** app (add one from a link or file without ticking "I wrote this") | It runs; its permission prompts appear | Console; try `localStorage["potyro:sandbox"]="quickjs"`, reload, compare |
| 6 | Realm probe: paste `docs/spikes/browser-realm/android/probe.js` into Web Inspector, `await __realmProbe()`; in a sealed app's frame, try `navigator.mediaDevices.getUserMedia({video:true})` | `hello.worker: true`, `origin: "null"`; getUserMedia from the sealed frame is **refused** | Not refused → security issue, report privately (§8) |
| 7 | An app with a photo field → Take a photo; then Choose one | Camera prompt once; the photo arrives; the library opens with no prompt | — |
| 8 | **Mirror Monsters** (`pnpm pack:app apps/mirror-monsters/mirror-monsters.app.ts -o mm.zip`, AirDrop it, Open with Potyro, tick "I wrote this") | Live front camera; googly eyes follow your eyes and blink; 🔄 switches camera; Snap saves to the Gallery; the green camera dot goes out on Home | Faces fail → the console says why (GPU vs CPU) |
| 9 | Plants → a plant's **Schedule** (or any reminder 2 minutes ahead). **Close the app normally** (swipe up, not from Xcode), lock the phone | The notification arrives on time with its title and body | Settings → Notifications → Potyro allowed? Run from Xcode detached |
| 10 | Places → New → **Use my location** | Prompt once; lat/lng filled | — |
| 11 | From Files, **share** a `.md` (and then three files at once) to Potyro | "Add this file to…" lists your apps; the file lands in the chosen app's Files tab | The extension: Xcode → Debug → Attach to Process → ShareExtension |
| 12 | Share text from Notes, and a link from Safari | The text arrives as something to add (#213) | — |
| 13 | On a file in Files, **Open with → Potyro** (one on the phone, one in iCloud Drive) | Same question as sharing | iCloud one fails → note it |
| 14 | Share a `.potyro-app.zip` to Potyro | Add an app opens on the app's card | — |
| 15 | Export an app | The zip is in Files → On My iPhone → Potyro | — |
| 16 | A full-screen app (a game) | Status bar hides; the ✕ leaves | — |
| 17 | On-device model (New app → describe → On-device) | Works if WebKit's WebGPU is on in WKWebView, else a clear error | Either answer is useful |

### 5.1 Owed: the web app added to the home screen from Safari (#123)

Not the native app: potyro.app in Safari, then Share → Add to Home Screen, which You offers on an
iPhone (`packages/shell/src/install-row.tsx`). WebKit is reported to give a home-screen web app its
own storage, apart from Safari's. If that holds, the installed Potyro opens with none of the apps
or records made in Safari, and with a new identity, and You should say so before offering it (or
offer it only before anything is made). Nobody has checked on a real device yet; until then the
row says only the two steps and makes no offline claim. Write the result here, with the iOS version
and model:

| Do | Expect | Result |
|---|---|---|
| In Safari, make an app and add a record. Add to Home Screen, open it from the icon | Is the app and its record there? Is the name in You the same? | not checked |
| From the icon, open Home and one example app, then turn on flight mode and reopen | Home and that app open; You → Offline says what is kept | not checked |

## 6. Known risks, ranked

| # | Severity | Risk | Fallback that exists | What would fix it |
|---|---|---|---|---|
| R1 | **High** | OPFS sync access handles unavailable in WKWebView on some iOS versions | The store falls back to IndexedDB (whole-file rewrite per save: slow as data grows, but nothing is lost) | A native SQLite VFS bridged through a Capacitor plugin, or wa-sqlite's IDB batch-atomic VFS; decide only on evidence from checklist #2 |
| R2 | **High** | Access handles closed while the app is suspended in the background (reported on Capacitor iOS) | Killing and reopening the app reopens the pool | Reopen the pool on `visibilitychange`/`App` resume when a handle throws `InvalidStateError`; needs the error text from checklist #4 |
| R3 | **High (distribution)** | App Review: Guideline 2.5.2 (no downloaded code that changes features) and 4.7 (HTML5/JS mini apps allowed, but 4.7.2 "may not extend or expose native platform APIs … without prior permission", 4.7.3 per-instance consent, 4.7.4 an index with universal links, 4.7.5 age gating). Potyro gives apps camera, location and notifications through `ctx`. | TestFlight **internal** testing needs no review | Owner decision 2 (§7) |
| R4 | **High** | Services unreachable from the app (no CORS for `capacitor://localhost` on the request and share services; the old site's basic-auth gate) | Local everything; AI through `https://potyro.app/ai` (CORS for the WebViews) or the person's own key; inline demo links | Owner decision 1 (§7) |
| R5 | Medium | 64 pending notifications per app | Soonest 64 kept (`makeRoom`); the rest come back when their app reconciles | A background refresh task that reconciles every app (§9) |
| R6 | Medium | A sealed frame reaching the camera through Capacitor's blanket `.grant` | WebKit Permissions Policy should refuse a cross-origin frame | Override `requestMediaCapturePermissionFor` to grant the main frame only — needs checklist #6 |
| R7 | Medium | Memory: a heavy app or the face model gets the WebContent process killed | Capacitor reloads the page; data is in SQLite | Per-Worker limits (docs/22 §6.1) |
| R8 | Medium | Share Extension cannot open the app on iOS 18+ | The share is read when Potyro next becomes active | None needed beyond a "Open Potyro to finish" line in the extension, if testers find it confusing |
| R9 | Low | WebKit storage eviction under disk pressure | `navigator.storage.persist()` asked each start | Nothing more on iOS; sync is the backup |
| R10 | Low | Faces slow on CPU (no OffscreenCanvas WebGL, or GPU refused) | The blob tracker in Mirror Monsters | — |
| R11 | Low | WebKit bug 301520 (database cannot reopen after `self.close()`) | Potyro uses `terminate()` | — |

## 7. Decisions the owner has to make

1. **Services from the native apps** (iOS and Android alike). Either (a) the Node services
   send `Access-Control-Allow-Origin` for `capacitor://localhost` and `https://localhost` (the AI
   relay on potyro.app already does, §2.1), Apache
   lets `OPTIONS` through the gate, and the routes the apps use are exempt from basic auth (rate
   limits as their guard) — the sync relay too; or (b) the app sends those calls through
   `CapacitorHttp` (no CORS), which still leaves the gate. Until then the native apps are local-only.
2. **App Review strategy** (R3): ship under 4.7 as a mini-app platform (index of apps with universal
   links, reporting/blocking for shared apps, age gating, and a request to Apple under 4.7.2 for the
   native capabilities), or position it under 2.5.2's education exception, or stay on TestFlight.
   This decides what the first external build may contain.
3. **Bundle id and team**: `app.potyro` under whose developer account (the trademark/entity question
   in the naming notes).
4. **Export compliance**: Potyro seals shared packages and uses WebCrypto; App Store Connect asks
   about encryption on every upload. Answer once and add `ITSAppUsesNonExemptEncryption` to the
   plist patch accordingly.
5. **Minimum iOS 17.** The patch sets it (OffscreenCanvas WebGL, getUserMedia fixes, `persist()`).
   16.4 would work for storage alone.

## 8. Reporting findings

Open a GitHub issue on **potyro-app/potyro** with the label **`platform:ios`** (plus `area:native`), one
issue per finding: iOS version, iPhone model, checklist number, what happened, the Web Inspector
console. A sealed app escaping its sandbox (checklist #6) is a security issue: tell the owner
directly instead of filing it publicly. A fix to the generated project goes into
`scripts/patch-plist.mjs` or `ios-templates/` in a PR, never as a committed `ios/`.

## 9. Native follow-ups we want later

- **Home-screen widgets and lock-screen Live Activities fed by live tiles.** A separate PR is adding
  an app-declared `tile` to `defineApp` (what an app shows on its launcher tile). On iOS the shell
  would write each tile's current value to the App Group (`group.app.potyro`, already set up for
  the Share Extension) and a WidgetKit extension renders them; a Live Activity for something
  in progress (a timer, a cook-along step) is started from the app through a small Capacitor plugin.
  No push: everything is local, and widgets refresh from the shared container on a timeline and
  when the app writes.
- **Universal Links** for `https://potyro.app/#join=…` and demo links: an `applinks:` entitlement
  plus `/.well-known/apple-app-site-association` on the site (the fragment survives, so the invite
  secret never reaches a server — `deep-links.ts`).
- **Background reconcile** (`BGAppRefreshTask`) so reminders past the 64 limit return without the
  app being opened.
- **The share sheet for exports** (`@capacitor/share`) instead of Documents.
- A native SQLite VFS, only if R1 or R2 is real.

## 10. Where the iOS-specific code is

| File | What |
|---|---|
| `packages/native/capacitor.config.ts` | pinned schemes, `contentInset: "never"`, the App Group for the share plugin |
| `packages/native/scripts/patch-plist.mjs` (+ `test/patch-plist.test.ts`) | Info.plist keys, deployment target, AppDelegate opened-file copy |
| `packages/native/ios-templates/` | Share Extension, its `NSExtension` plist, the privacy manifest, the `PotyroSpeech` plugin (§4.7) — **uncompiled** |
| `packages/native/src/capacitor-capabilities.ts` | `makeRoom` / `IOS_PENDING_LIMIT` (+ `test/pending-limit.test.ts`) |
| `packages/native/src/keep-storage.ts` | `navigator.storage.persist()` on native start |
| `packages/shell/src/site.ts` | `VITE_POTYRO_SITE`: the site a native build belongs to |

## Sources

- sqlite.org/wasm — [Persistent Storage Options](https://sqlite.org/wasm/doc/trunk/persistence.md)
- PowerSync — [The Current State Of SQLite Persistence On The Web: May 2026](https://powersync.com/blog/sqlite-persistence-on-the-web)
- WebKit — [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/), [Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/), [bug 301520](https://bugs.webkit.org/show_bug.cgi?id=301520)
- Thinktecture — [iOS 14's ITP and WKWebView](https://www.thinktecture.com/en/ios/wkwebview-itp-ios-14/)
- Capacitor — [#6759 getUserMedia on iOS](https://github.com/ionic-team/capacitor/issues/6759), [#7069 service workers](https://github.com/ionic-team/capacitor/issues/7069), [Camera](https://capacitorjs.com/docs/apis/camera), [Geolocation](https://capacitorjs.com/docs/apis/geolocation), [Filesystem](https://capacitorjs.com/docs/apis/filesystem), [Local Notifications](https://capacitorjs.com/docs/apis/local-notifications); `@capacitor/ios` 8.4.2 source (`WebViewAssetHandler.swift`, `WebViewDelegationHandler.swift`, `CAPBridgeViewController.swift`)
- Apple — [64 pending notifications](https://developer.apple.com/forums/thread/811171), [App Review Guidelines 2.5.2 and 4.7](https://developer.apple.com/app-store/review/guidelines/)
- MDN browser-compat-data — [#21127 OffscreenCanvas WebGL2 in workers on iOS 17](https://github.com/mdn/browser-compat-data/issues/21127)
- Cap-go — [capacitor-share-target](https://github.com/Cap-go/capacitor-share-target) README and iOS source
