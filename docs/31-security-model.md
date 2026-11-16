---
title: Security model
description: What keeps a shared app in its box, what the servers can see, what is not protected, and how to report a hole.
status: current
order: 31
---

# 31 · Security model

Potyro runs apps that other people wrote. This page says, in plain words, what stops such an app
from doing harm, what our servers can and cannot see, and what is **not** protected. Every claim
names the code or the doc it comes from. The details are in docs/07 (execution and trust) and
docs/22 (the browser realm, with its measurements).

## 1. Provenance decides how an app runs

The app does not choose its box. Where it came from does (`docs/07-execution-and-targets.md`,
"Provenance → execution mode"; the switch is `mediateCaps` in `packages/host/src/mediate.ts` and the
shell's `packages/shell/src/sandbox-runner.ts`).

| The app is | Because | It runs |
|---|---|---|
| **Yours** (trusted) | you made it in the Studio, or you said "run it as mine" | **direct**, in the shell's page, with every capability and no prompts |
| **Someone else's** (sealed) | it came from a link, a shared package, a file or a demo | in the **browser realm** (below) — or, where the browser cannot build one, in the fallback box (§6) — with only the capabilities it declared and you allowed |

Everything comes in sealed. A link never makes an app trusted, and an update from a link puts a
trusted app back in the box, so a link cannot put new code into an app that runs with your full
authority (docs/07, "Trust at install"). Running a sealed app as yours is one explicit dialog
(`packages/shell/src/trust-dialog.tsx`), and it can be undone.

Two more ways code arrives, and the same rule holds for both:

- **A version published into a shared space.** Everyone who can write to a space can publish a
  version of its app, and each person is asked before their copy takes it. Saying "Update" accepts
  the version, not its standing: unless the store's signed log shows that this person's own account
  published it (another of their devices), the copy runs sealed from then on, whatever it was before
  (`takeUpdate` in `packages/shell/src/version-gate.ts`, `Store.kvOwn`).
- **Your apps on a new device.** The account's list holds every synced app, the ones you joined
  beside the ones you made, and each entry records which it is. A new device runs directly only an
  app one of your devices recorded as yours; a joined app, or an entry written before this was
  recorded, comes back sealed (`installFromAccount` in `packages/shell/src/restore-apps.tsx`).

The language is never restricted. A sealed app is the same TypeScript as a trusted one; only the
authority handed to it differs.

## 2. A sealed app's logic: a Worker in a sandboxed frame

Code: `packages/host/src/realm/` (docs/22 §10).

- **An opaque-origin frame.** Each open sealed app gets an `<iframe sandbox="allow-scripts" srcdoc>`
  and nothing more: no `allow-same-origin`, so its origin is opaque and it cannot read the shell's
  page, cookies, storage or IndexedDB (`frame.ts`, `sandboxed`).
- **A Worker inside it** runs the app's bundle (`worker-runtime.ts`). The frame's own script is a few
  lines that start the Worker and hand it a port.
- **A strict CSP** on the frame (`REALM_CSP` in `protocol.ts`): `default-src 'none'`,
  `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`; scripts only inline and from
  `blob:`. `'unsafe-eval'` and `'wasm-unsafe-eval'` are allowed on purpose: the bundle is evaluated
  with them, they load nothing, and the frame is the boundary. The app cannot fetch, open a socket or
  load anything from the network by itself.
- **WebRTC removed.** CSP does not govern WebRTC, and no engine honours `webrtc 'block'`. The frame
  deletes the RTC constructors before any other code runs (`NO_WEBRTC` in `frame.ts`). Workers never
  had them.
- **No navigating away.** The shell is served with `frame-src 'none'` (`packages/shell/index.html`,
  `SHELL_CSP` in `packages/shell/vite.config.ts`, and the header potyro.app's Caddy sends,
  `deploy/potyro.app.Caddyfile`), so a sandboxed frame cannot navigate itself to a server to leak
  data (docs/22 §3.2, §10.4).
- **Only through `ctx`, over a MessagePort.** The app reaches the host by messages on its port. The
  host accepts only operations on an allow-list (`OPS` in `protocol.ts`) and only for ctx ids it
  issued to that app (the last 512; `CTX_WINDOW` in `realm-host.ts`). Each operation is the same
  method call a trusted app makes, on a `ctx` that is mediated (§4); arguments are coerced to plain
  values. Functions never cross; data crosses by structured clone.

## 3. A sealed app's screens: a frame per view

Code: `packages/host/src/realm/sealed-view.ts`, `view-runtime.ts` (docs/22 §11).

A sealed app's custom view draws in its own sandboxed frame, one per mounted view, in the place of
the page's content. It has the same authority as the logic and no more: `sandbox="allow-scripts"`
only, the same CSP, WebRTC deleted, its own port with the same op list plus a few view operations
(`VIEW_OPS`). The shell keeps the header and the navigation. Removing the frame removes everything
the view left behind.

## 4. Capabilities: denied by default, then asked

Code: `adaptMediated` in `packages/host/src/mediate.ts` (docs/07, "The `ctx` mediation layer").

- A sealed app gets **only the capabilities its `permissions` manifest declares**. Anything else is
  absent or refused.
- Each sensitive one (camera, location, files, network, notifications, AI, voice) **asks the person
  first**. Haptics is declared but not asked.
- **What is scoped, and by whom.** The app's manifest sets the limits, not the person's answer:
  `network.fetch` only to the hosts the manifest names (`networkAllowed`; `network: true` or `{}`
  names none and means every host); file saves under an app-private prefix; a socket only to a host
  the manifest names (docs/28). A call outside those limits is refused with no question.
- **What the person is asked is coarser than those limits.** The declared hosts are shown once,
  when the app is added and in the trust dialog ("the internet", or each site by name:
  `packages/shell/src/capability-words.ts`). The question at the moment of use does not repeat them.
  For `fetch` it is one sentence, built in `makeConsentGate`:

  > Allow “{app}” to use the network?

  It names no host and says nothing of what is sent; an app that declared one site and an app that
  declared every site ask in the same words, and one yes covers every host the manifest allows. The
  sentence is written in `mediate.ts`, not in the i18n catalogs, so it is English on every device
  (camera, location, files and notifications share that gate and its form). The answer, yes or no,
  holds for the `ctx` that asked (a `ctx` is built per pass: one run of an action, for one) and is
  neither kept on the device nor per host.
- **Live connections are asked properly.** A socket asks once per app and host, names the host, and
  the yes is kept on the device (`packages/host/src/sockets.ts`, the catalog string from
  `packages/shell/src/app-sockets.ts`):

  > “{appName}” wants a live connection to {host}.
  > While the app is open it can send and receive anything there. Potyro closes the connection when you leave the app.

  **Open:** the `fetch` question should say where the app may go, as the socket's does, go through
  the catalogs, and be kept per host. Until then, read "allow the network" as "allow every host this
  app declared".
- **Data is per app.** The store is opened per app id, and a sealed app only ever holds a `ctx` bound
  to its own store, files and storage. It cannot read another app's records (docs/07).
- The key that pays for AI is never in reach of app code: the shell holds it, or the free relay
  does (docs/23).

## 5. The watchdog

A shared app cannot hold Potyro hostage by spinning.

- **Logic** (`realm-host.ts`): each call has a deadline (1 s by default, 5 s for loading), the Worker
  beats every 100 ms, and a realm silent for 1 s is stopped: the frame and its Worker are removed and
  what was waiting is rejected. The deadline pauses while the app waits on the person or the world (a
  prompt, a dialog, a fetch). A realm that posts more than 2,000 messages in 50 ms is stopped too.
  The next call starts a fresh realm.
- **Views** (`view-watchdog.ts`, `view-guard.ts`): pings every 250 ms; a view that does not answer for
  2 s, blocks the page's thread for 2 s, or takes over 10 s to mount is removed, and the page shows
  the app's plain version. Where the frame shares the shell's thread (Firefox, WebKit, Chromium
  without site isolation), a view that never yields freezes Potyro until the tab is closed; a
  crash-loop guard then turns that app's views off, so it happens **at most once per app**.

## 6. The fallback box

Code: `packages/host/src/isolate/`, `packages/shell/src/sandbox-runner.ts`,
`packages/shell/src/isolate-bridge.ts` (docs/07, "The QuickJS fallback"; docs/22 §10.3).

The second sealed box is a QuickJS-WASM isolate: a JavaScript engine compiled to WebAssembly, with
no ambient authority at all and the same mediated `ctx` behind one bridge. It is not behind a
switch. The product uses it:

- **by itself, where the realm cannot be built or will not start** (no Worker, or a browser where
  the frame fails: `realmAvailable()`, `RealmStartError`), for every shared app until the page is
  reloaded;
- **always, for the Studio's checks**, on every device: a candidate is validated, run on sample
  records and verified in QuickJS before it is accepted, and someone else's app opened in the Studio
  is previewed there (your own app is previewed direct, §9);
- when a device or a build asks for it (`localStorage["potyro:sandbox"]`, `VITE_POTYRO_SANDBOX`).

What it does not do: it draws **no screens of an app's own** (it has no frame; the page says the
screen runs only when the app runs as yours and names the pages that do work), it has **none of the
browser's built-ins** (`Intl`, `URL`, timers, `Blob`), and **`ctx.caps.network.fetch` throws**
there. Sockets, rooms, files, AI and the questions an app asks are carried. So the fallback is
strictly narrower than the realm in what an app can reach.

Its memory is bounded: the engine lives in a WebAssembly memory of its own that cannot grow past
96 MB, and an app that asks for more is stopped and its memory let go (docs/22 §6.1).

Its tests: the unit tests in `packages/host/test/`, and one browser project, `sandbox-quickjs`
(`pnpm test:e2e:quickjs`), which runs the sealed specs in it. **That project is not part of the
gate**, so a regression in the fallback is found when someone runs it, not on every merge.

## 7. What our servers see

All of them run on one server, behind Caddy on potyro.app, each published to that machine's
loopback only (docs/16 has the table, `deploy/` the configuration):

- **Sync relay**: it stores and forwards encrypted data; the keys are with the members of a space,
  and an invite's key travels in a link fragment that never reaches a server (docs/16).
- **Share service** (demo links): it holds the app encrypted with a fresh key per link, the key in the
  fragment. It sees the title, description and preview image the sharer made public (docs/24 §2).
- **Rooms relay** (multiplayer): it sees the frames it forwards in plain text. It does not store or
  log them (docs/26 §4).
- **AI relay** (the free allowance): it sees what an app sends (the text or photo and the question),
  passes it to the model provider through OpenRouter, and keeps the month's spend and a count per
  random device id (`packages/ai-relay/src/relay.ts`). With your own key, requests go from your
  device to your provider and the relay is not involved (docs/23).

## 8. What is not protected

Read this before you rely on Potyro for something that matters.

- **Your own apps have your full authority.** A trusted app runs in the shell's page. It can do
  anything script on that origin can do, including the next point. Run an app as yours only if you
  would run its code.
- **The web vault is not a wall against script on the same origin.** In a browser, the identity's
  secrets are encrypted with a non-extractable WebCrypto key, but any script on the origin can still
  ask that key to decrypt. It removes the secret lying in the clear, nothing more. The native vault
  on Android and iOS is hardware-backed (`packages/identity/src/vault.ts`; docs/10, #57).
- **A record's link is the record.** A link made with `ctx.ui.share({ record })` (docs/24 §12)
  carries, in its fragment, an invite secret for that record's own group: whoever has the link can
  read the record — and write it, if the link said so — and whatever points at it, for as long as
  the group exists. Nothing else of the app's. Treat the link as you would the document. Taking a
  link back is not built yet.
- **The sync operator can see the social graph.** Transactions are encrypted; group and account
  metadata are not. Whoever runs the sync relay can see which accounts share which spaces, and when
  they are active (docs/16, "What this does NOT protect").
- **An invite link is the whole capability.** Anyone with it is in; one link cannot be revoked short
  of rotating the space's keys (docs/16).
- **Rooms frames are plain text to the relay** (docs/26 §4). An app that needs more encrypts its
  messages itself, with a key in the link's fragment.
- **A sealed app's memory is not capped in the realm**, and no browser offers a way to cap it (the
  fallback box has a cap, §6). The effect is on availability only. Measured: desktop Chromium ends
  the sealed frames' process and the shell lives; Firefox, and Chromium without site isolation, can
  end or hang the tab. What the shell itself keeps for a sealed app is bounded; an app stopped three
  times in two minutes is paused until the person starts it; an app that was open when a tab died
  is not started again by itself. WebKit and Android are not measured (docs/22 §7.1). An app may
  start nested Workers from `blob:`; they end with its frame (docs/22 §6.1, §10.5).
- **The WebRTC removal is a deny-list.** It has to be checked again on every engine release and for
  every new API that opens a channel CSP does not govern (docs/22 §10.5).
- **Android WebView** has not been measured for the realm (docs/22 §5). If the realm will not start
  there, the shell uses the QuickJS box (§6).
- **The fallback box is tested less than the realm.** It is a supported path (§6) whose browser
  project is outside the gate.
- **Code a model wrote runs as yours** (§9).
- **A sealed screen can make the browser look a name up** (§10): in Firefox, measured, it does;
  the app's logic cannot.

## 9. Code a model wrote, in your own app

An app you make in the Studio is yours: it runs **direct**, in the shell's page, with every
capability and no prompts (§1). Its code was written by a language model, the engine you chose
(docs/00, "The Studio and the generator"). Two consequences follow, and neither is a bug in the box,
because your own app is not in one.

- **Text the model reads can end up as code.** The model is given your request, the app's current
  source, passages of the reference and the corpus that ship with the release, and the failures its
  own candidates produced. Whatever is in those is input to the program that writes your app:
  instructions in a request pasted from somewhere else, a comment or a string in source you copied
  in. A model can follow such text. The result is not a
  wrong answer in a chat; it is code that runs with your authority on this origin, which includes
  reading every app's data on the device and asking the web vault's key to decrypt (§8).
- **The engine is trusted with that authority.** Whoever answers for the model — a provider, a
  gateway, an endpoint you typed in by base URL — returns code that will run as yours. A dishonest
  or compromised endpoint needs no injection.

What stands between, and what it is worth:

- A candidate is **checked before it is accepted**, and the checks run it sealed, in QuickJS, on a
  throwaway store with a budget (`packages/shell/src/verify-candidate.ts`, `run-candidate.ts`). The
  checks ask whether the app still works: it compiles, validates, loses no entity or page, and its
  pages and actions run on sample records. **They do not ask what the code does with its reach.**
  Code that works and also sends your records somewhere passes.
- **The sealed check is not the first time the code runs.** A version of your own app is built the
  moment it arrives, direct, so the Studio can show it as it will run
  (`packages/shell/src/studio-preview.tsx`, `loadTrustedModule`). Whatever the module does as it
  loads has run with your authority by then, before any summary is read.
- Every accepted change is **a version in History**, and can be undone. Undoing restores the code;
  it does not take back what the code already did.
- **A sealed app stays sealed in the Studio.** Opening someone else's app in the Studio, or changing
  it there, does not make it yours; that takes the trust dialog (§1).
- `ctx.caps.ai` inside an app is a different thing: its answer is data, checked against the shape
  the app asked for, never evaluated (docs/23).

There is no review of model-written code for intent, by a person or by a program, between the model
and your authority. Treat a request you paste from a stranger as you would a script they asked you
to run, and an engine as you would the author of your apps.

## 10. Names leaving a sealed screen (DNS)

CSP governs what a frame may **load**. A browser can also be asked to **look a name up** without
loading anything: `<link rel="dns-prefetch">`, `<link rel="preconnect">`, a link it expects to be
followed. The question goes to the device's resolver and from there to whoever runs the name's
zone. A sealed app's screen writes its own DOM (§3), so it can put such a hint there, and a name
like `what-it-read.example.org` carries a few dozen bytes out per lookup, with no permission asked
and nothing in the app's manifest. It is slow, one-way and needs the app's author to run a DNS
zone; it is also exactly the kind of exit the box exists to close. The app's logic has no such
exit: a Worker has no document to put a hint in.

Measured on 2026-11-16 with `e2e/dns-prefetch-probe-sandbox.spec.ts` (opt-in,
`POTYRO_DNS_PROBE=1`), in the browsers Playwright 1.62 installs on Linux (Firefox 153, Chromium
151). A shared app's own screen puts each hint in its frame's document; a control page with no CSP
does the same in the same browser. The evidence is the browser's own record of its resolver
(Firefox's `nsHostResolver` log, Chromium's net-log), not the app's word. "Not measurable" means
the control made no lookup either, so the method cannot tell there: it is not a pass.

| From a sealed screen | Firefox | Chromium |
|---|---|---|
| `<link rel="dns-prefetch">` | **looked up** | not measurable |
| `<link rel="preconnect">` | **looked up** | not measurable |
| `<a href>`, hovered | **looked up** | not measurable |
| `<link rel="prefetch">` | not looked up | not looked up |
| `<link rel="preload">` | not looked up | not looked up |
| `<img src>` | not looked up | not looked up |
| `fetch()` | not looked up | not looked up |
| `fetch()` from the logic's Worker | not looked up | not looked up |

So: everything CSP names is stopped before a name is resolved, in both engines. **In Firefox, a
sealed screen's dns-prefetch, preconnect and link hints are resolved**: a shared app with a screen
of its own can send what it holds to its author's DNS zone from Firefox, a few bytes at a time.
In Chromium the three are **unmeasured, not safe**: as Playwright runs it (the headless shell, full
Chromium, and full Chromium with `--disable-background-networking` taken off) the control page
made no lookup for them either, so the probe cannot see what a person's Chrome does. WebKit and the
Android WebView are not measured.

**Open.** Nothing in the realm stops this today. Two things to try, neither verified: Firefox
decides DNS prefetch per document and inherits the decision from the embedding page, so
`X-DNS-Prefetch-Control: off` on the shell's response, or its `<meta http-equiv>` in the view's
document (`viewDocument` in `frame.ts`), may cover dns-prefetch and links; preconnect is a
separate mechanism and may need the browser to honour CSP for it. The probe is the test for any
fix: it must show the control still looking the names up and the sealed screen not. Until then,
on Firefox a sealed app that draws its own screen should be counted as able to tell its author a
little, slowly, without asking.

## 11. For an audit

The surface a security review should cover, from docs/22 §10.5 and §11.5:

- the op allow-list and ctx ids: `OPS` and `VIEW_OPS` in `protocol.ts`, `answer` and `route` in
  `realm-host.ts`; every op on the list is a boundary that takes values from untrusted code;
- the frame runtime and the WebRTC removal (`FRAME_SOURCE`, `NO_WEBRTC` in `frame.ts`), and the
  view frame's document (`viewDocument`), each with the runtime inlined and `</script` escaped;
- the realm CSP (`REALM_CSP`) and the iframe's `sandbox="allow-scripts"`; the `postMessage(…, "*")`
  at start that hands over the ports (the ports, not the origin, are the trust boundary);
- the shell's `frame-src 'none'`, which must stay in step in `index.html`, `vite.config.ts` and the
  server's configuration (`deploy/potyro.app.Caddyfile`);
- the watchdog: deadlines and what pauses them, the heartbeat, the flood guards, the fall back to
  QuickJS on `RealmStartError`;
- what crosses by structured clone (Blobs, bytes, Dates in and out; getters are read during the copy);
- `view-runtime.ts`, untrusted like the worker runtime, since app code shares its realm; the bytes the
  host fetches for a view's `blob:` and `data:` URLs; the crash-loop guard's localStorage keys
  (written only by the shell);
- the mediation (`mediate.ts`, `make-ctx.ts`, `values-gate.ts`) and trust at install
  (`trust-dialog.tsx`, `promotion.ts` in the shell).

The QuickJS marshal and bridge (`packages/host/src/isolate/`) are in scope while the fallback ships,
which is now: the shell chooses it by itself and the Studio's checks always use it (§6). What a
review covers there: what the harness (`harness.ts`) hands the host, `bytesOfBase64` and the held
captures in `isolate-host.ts`, and the choice of box (`sandbox-runner.ts`, the fall back on
`RealmStartError`).

## 12. Reporting a hole

Privately, never in a public issue: GitHub's private vulnerability reporting on this repository, or
the address in `SECURITY.md`. We acknowledge within 7 days. There is no bounty. `SECURITY.md` says
what is in scope.
