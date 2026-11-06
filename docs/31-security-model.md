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
| **Someone else's** (sealed) | it came from a link, a shared package, a file or a demo | in the **browser realm** (below), with only the capabilities it declared and you allowed |

Everything comes in sealed. A link never makes an app trusted, and an update from a link puts a
trusted app back in the box, so a link cannot put new code into an app that runs with your full
authority (docs/07, "Trust at install"). Running a sealed app as yours is one explicit dialog
(`packages/shell/src/trust-dialog.tsx`), and it can be undone.

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
  first**, in words that name the app and what it wants. Haptics is declared but not asked.
- Granted capabilities are **scoped**: `network.fetch` only to the hosts the manifest names; file
  saves under an app-private prefix; a socket only to a named host, asked once per host
  (docs/28).
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

Where the realm cannot start (no Worker, or a browser where the frame fails), the shell runs shared
apps in a QuickJS-WASM isolate instead, still sealed, with the same mediated `ctx`
(`packages/host/src/isolate/`, docs/22 §10.3). It is behind a flag and due to be removed.

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
- **A sealed app's memory is not capped**, and it may start nested Workers from `blob:`; they end
  with its frame (docs/22 §6.1, §10.5).
- **The WebRTC removal is a deny-list.** It has to be checked again on every engine release and for
  every new API that opens a channel CSP does not govern (docs/22 §10.5).
- **Android WebView** has not been measured for the realm (docs/22 §5). If the realm will not start
  there, the shell uses the QuickJS box (§6).

## 9. For an audit

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

The QuickJS marshal and bridge (`packages/host/src/isolate/`) are in scope only while the fallback
ships.

## 10. Reporting a hole

Privately, never in a public issue: GitHub's private vulnerability reporting on this repository, or
the address in `SECURITY.md`. We acknowledge within 7 days. There is no bounty. `SECURITY.md` says
what is in scope.
