---
title: Live connections
description: ctx.caps.network.socket and .room: WebSockets and rooms from app code, with permission and limits.
status: current
order: 28
---

# 28 — Live connections: `ctx.caps.network.socket` and `.room`

Status: built (owner decisions 2026-10-15). Apps reach a WebSocket server — a price stream, a home
hub, a chat — with `ctx.caps.network.socket(url)`, and play together in a room on Potyro's own relay
(docs/26) with `ctx.caps.network.room(id)`. **The same API for your own apps and for shared (sealed)
ones**; what differs is the authority behind it (§3). The types are in
`packages/schema/src/types/sockets.ts`; the Studio's model reads them with
`lookup("ctx.caps.network.socket")`.

## 1. The API

```ts
const s = await ctx.caps.network.socket("wss://stream.binance.com:9443/ws/btcusdt@trade", { protocols: ["v1"] });
// options: protocols, and keepWhileHidden: "90s" | "5m" (§5) — rooms take it too
s.readyState;                      // "open" — socket() resolves only once it is
s.protocol;                        // the subprotocol the server chose, or ""
await s.send("text");              // or a Uint8Array; resolves once on its way
s.onMessage((d) => …);             // text as a string, binary as a Uint8Array; returns the unsubscribe
s.onClose(({ code, reason, why }) => …);
s.close();                         // code 1000 unless given (or the app's own 3000–4999)
```

`socket()` rejects with an `Error` whose `code` the app words for the person:

| `code` | What happened |
|---|---|
| `"offline"` | the device has no connection (or cannot open any) |
| `"denied"` | the person said Not now — asked again next time |
| `"refused"` | the server said no or closed at once (a browser does not say more), or Potyro closed it before it opened because the person left |
| `"unreachable"` | no answer within 15 s; a build with no rooms relay |
| `"not-allowed-host"` | a shared app asked for a host its `permissions.network` does not name — refused at once, nobody asked |
| `"insecure"` | `ws://` where only `wss://` can work (§6) |
| `"too-many"` | this app already holds 4 connections |
| `"hidden"` | Potyro is in the background, where nothing opens — try again; the first try after the person comes back opens (§5) |
| `"off"` | the person turned this connection off for the app in Edit tile (§3) — nobody is asked; it stays off until they turn it on there. Do not retry |

`send` rejects with `"closed"`, `"too-big"` (one message over 1 MiB; a room's own limit, 64 KiB) or
`"full"` (more than 1 MiB still waiting to go out — slow down). A bad address or a non-ws scheme is a
`TypeError`: a bug in the app, not something to word.

`onClose`'s `why`: `"app"` (it closed it), `"server"` (with the server's `code` and `reason`),
`"network"` (dropped, 1006), `"left"` (the person left the app), `"hidden"` (Potyro was in the
background 30 s, or the `keepWhileHidden` the app asked for), `"too-big"` (the server sent one message
over 1 MiB: 1009), `"slow"` (messages piled up faster than the app took them: 1008), `"stopped"` (a
shared app's box was stopped by its watchdog), `"off"` (the person turned it off in Edit tile).
An `onClose` registered after the end is called at once with how it ended.

Messages that arrive before `onMessage` is called are held and handed to the first callback, so none is
lost between the connect and the listening. Inside a callback `ctx` still works — write what arrives
as records (`ctx.create`, `ctx.patch`) and every view follows — but `ctx.now()` is the time of the call
that opened the connection: use `new Date()` for when a message came. Keep the socket in a
module-level variable: it outlives the action that opened it.

## 2. Rooms: `ctx.caps.network.room(id?, { name? })`

```ts
const room = await ctx.caps.network.room(id);   // room() alone makes a new id (128 random bits)
room.id;                                         // put it in a share link: anyone with it can join
room.me;                                         // { id, name } — the relay's id for this connection
room.members;                                    // everyone else here, oldest first, kept current
room.onPresence(({ type, member }) => …);        // "join" | "leave"
room.onMessage((d) => …);                        // the OTHER members' messages, exactly as sent
await room.send(JSON.stringify({ stroke }));     // never comes back to you
```

`room` is the shell's own address for the relay, `<site>/rooms/<id>?name=` (the site's `/rooms`;
`VITE_POTYRO_ROOMS` for a build that puts it elsewhere; a native build's site is `VITE_POTYRO_SITE`).
It resolves after the relay's `welcome`, and reads the `{"potyro-rooms":…}` envelope (docs/26 §2)
itself, so an app never writes the prefix test: presence arrives typed and peer frames as plain
messages. A text message an app sends may not begin with `{"potyro-rooms":` (a `TypeError`; the relay
would close it with 4005). The relay's limits apply (16 members, 64 KiB a message, about 30 messages a
second; docs/26 §3), its close codes reach `onClose` as `why: "server"`, and a relay that closes before
its welcome (room full, 4002) makes `room()` reject with `"refused"` and its reason.

**Why a separate member, not an option of `socket`.** It returns something else (`me`, `members`,
`onPresence`), the app never knows the relay's address (the shell does: it is the site's, and it moves
with `VITE_POTYRO_SITE` in a native build), the consent words name "Potyro’s rooms" rather than a raw
host, and a shared app declares it with `rooms: true` rather than a host it could not know. An option
would have made `socket()`'s return type depend on a flag and pushed the envelope into every app.

`name` is shown to the others, cleaned by the relay (at most 40 characters); none is sent unless the
app passes one — `ctx.me.name` is the person's, and sending it is the app's choice.

## 3. Trust: what differs

| | Your own app | A shared (sealed) app |
|---|---|---|
| Hosts | any | only those in `permissions.network.hosts` (a host without a port matches any port); others refused at once, nobody asked |
| Potyro's rooms | yes | with `permissions: { network: { rooms: true } }` (or `network: true`); `{ rooms: true }` alone allows no other host, for `fetch` either |
| Question | none | once per app and host (or the rooms), on this device: “**“Price Board” wants a live connection to stream.binance.com.**” / “…**to Potyro’s rooms.**” — *While the app is open it can send and receive anything there. Potyro closes the connection when you leave the app.* / *Everyone with the room’s link sees what the app sends there. …* — **Allow** / **Not now** |
| The answer | — | kept per app on this device (`potyro:sockets:<appId>`, never `ctx.storage`, which the app can write), forgotten when the app is deleted; Not now is never kept |
| Taking it back | — | Edit tile → **Live connections**: a switch per place it was allowed (below) |
| Limits | 4 connections, 1 MiB a message, 1 MiB waiting each way | the same |
| Where the socket lives | the shell's page | the shell's page — never the sealed frame (§4) |

Two connects at once ask one question; the slot is held while the person is asked, so four questions
cannot become five connections.

**Taking it back: Edit tile's "Live connections".** Once an app has been allowed somewhere, its Edit
tile (on the launcher, or from the switcher while the app is open) lists each place — the host, "Potyro’s
rooms", or the home device's address — with a switch, the way the AI switch works there. On Save:

- **off** closes the app's open connections there **at once** (`onClose` hears `why: "off"`) and
  refuses the next with `"off"`, without a question — the switch is the answer, so an app retrying in
  a loop does not bring the question back again and again;
- **on again** lets it connect without a question;
- a home device also has **Change address**, which forgets it: the next connection asks for the
  address again (and closes what is open now).

The stored answer is `{ on: [...], off: [...] }` (the list of allowed targets it replaced is still read).
The shell tells the host through `SocketCap.onTurnedOff`, which the host listens to only while the app
holds a connection. A trusted app is never asked, so it is listed only for a home device it was given.

## 4. Where the connection lives

The **shell** opens every WebSocket (`capabilities/src/sockets.ts`, one `SocketCap` per page). A sealed
app's logic runs in an opaque-origin sandboxed frame whose CSP is `connect-src 'none'` — it connects
nowhere, and a socket opened there would send `Origin: null`, which the rooms relay refuses
(docs/26 §5). The host mediates (`host/src/sockets.ts`, the same code for every app) and carries a
sealed app's connections into its box (`host/src/socket-bridge.ts`):

- the box holds a number per connection; four ops — `caps.network.socket`, `caps.network.room`,
  `caps.network.socket.send`, `caps.network.socket.close` — go to the host, which checks each against
  the app's own table;
- events go in as `{ t: "sock", ev }` on the realm's MessagePort (bytes as themselves), or through
  `__potyro.sock(json)` into QuickJS (bytes as base64, like everything on that bridge), in order, and
  only after the box has the connection's number;
- **flow control**: the box acks each message it hands to the app's `onMessage`; at most 64 events or
  1 MiB are in the box untaken, and at most 1 MiB waits beyond that — an app that does not keep up is
  closed `"slow"` rather than filling the page's memory;
- the ctx a connection was opened through stays nameable while it is open (its callbacks use it);
- a box the watchdog stops takes its connections with it (`"stopped"`), and closing the app closes
  them (`"left"`).

## 5. Potyro closes them; it never reconnects by itself

Every connection ends when the person **leaves the app** (the shell, like the live camera's), when
Potyro has been **hidden for 30 s** (`HIDDEN_CLOSE_MS`; coming back sooner cancels it), when the device
goes away, or when a connection still opening is overtaken by either — it never opens behind the
person's back. The app hears why.

**A longer grace for a chat: `keepWhileHidden`.** `socket(url, { keepWhileHidden: "5m" })` (and
`room(id, { keepWhileHidden: "5m" })`) keeps that one connection open for up to that long while Potyro
is hidden — seconds (`"90s"`) or minutes (`"5m"`), **at most 15 minutes** (`HIDDEN_KEEP_MAX_MS`; a
longer one is held to 15 min, a value that is neither is a `TypeError`). Each connection has its own
timer, so a chat's room can outlast a price stream opened by the same app. Why a cap and not "until the
person comes back": a connection the person walked away from should not run all afternoon on their
battery and data, and "it never runs behind the person's back" still holds — it is this connection,
for a bounded while. Why allow it at all: thirty seconds is less than a look at a message in another
app, and a chat dropped every time costs the person their place (a new member id, the others seeing a
leave and a join). It is "at most": a phone may stop a backgrounded app's network sooner (Android
pauses a WebView in the background), and the app hears `"network"` or `"hidden"` either way.

There is no `reconnect: true`. A reconnect is a new connection: in a room it is a new member id (the
others see a leave and a join), a server's subscriptions must be sent again, and whether to come back
after `"left"` or `"hidden"` is the app's decision — Potyro should not silently re-open a connection
the person walked away from. The pattern is short:

```ts
let live: Socket | null = null;
let wait = 1000;

async function connect(ctx: Ctx): Promise<void> {
  try {
    live = await ctx.caps.network!.socket(URL);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "denied" || code === "not-allowed-host" || code === "insecure") return; // retrying will not help
    setTimeout(() => void connect(ctx), (wait = Math.min(wait * 2, 30_000)));
    return;
  }
  wait = 1000;
  await live.send(JSON.stringify({ subscribe: "btcusdt@trade" }));     // what the server must hear again
  live.onMessage((d) => { /* … */ });
  live.onClose(({ why }) => {
    if (why === "network" || why === "server") setTimeout(() => void connect(ctx), wait);
  });
}
```

**Picking up again when the person comes back.** Nothing opens while Potyro is in the background:
`socket()` and `room()` reject at once with `"hidden"` there. So an app that wants to carry on after
`why: "hidden"` tries again every few seconds — each try costs nothing while hidden — and the first
one after the person returns opens. The hero apps (`apps/earthquakes`, `apps/word-watch`,
`apps/ticker`, each `live.ts`) do this; after `"left"` they wait for the person to start again.

```ts
live.onClose(({ why }) => {
  if (why === "hidden") retryEvery(3000);   // rejected with "hidden" until they are back
});
```

**After the person leaves, nothing opens.** A trusted app's module lives on in the page, and a retry
timer it set can fire after the app was closed; the host refuses that app's `socket()` and `room()`
from then on (`"refused"`, `retireAppSockets` on close). A sealed app's box is gone with it anyway.

**Long work from a button.** A sealed app's box gives each call about a second (its watchdog) of the
app's **own** time. Waiting is not counted: a question to the person, the AI, and the network — a
`fetch`, a `socket()` or `room()` connecting (and the question before it), however long the server
takes — pause the call's budget, in the realm and in QuickJS alike (the same `question()` /
`openQuestion()` accounting; `host/test/network-budget.test.ts` proves a connect and a fetch slower
than the whole budget finish, and that spinning is still stopped). QuickJS has no `fetch` at all
(`network fetch is not marshalable`); only the realm's pauses for it. Filling in a day of data, or a
demo's backlog, is the app's own time and takes longer: the button starts the work and returns, and
the work goes on (with the ctx of that call) and says how it is going through records — the hero apps'
status line is an aggregate view over one record.

## 6. `ws://` — where it can work

- **The web build: `wss://` only**, except `ws://` to the device itself (`localhost`, 127.0.0.0/8,
  `::1`), which browsers allow from an https page. Anything else is mixed content the browser would
  block anyway; Potyro refuses it first with `"insecure"`. A page served over plain http (the dev
  server) may open any `ws://`.
- **The Android app: `ws://` to the local network too** — a Home Assistant on the local network, port 8123. The
  WebView is `https://localhost` and refuses ws:// from it, so these go through Potyro's own plugin
  (`PotyroLocalSocket`: `packages/native/android-templates/`, copied into the generated project and
  registered in `MainActivity` by `scripts/patch-android.mjs`, which `cap:add:android` and `cap:sync`
  run). Local means loopback, 10/8, 172.16/12, 192.168/16, link-local (169.254/16, fe80::/10), IPv6
  unique-local (fc00::/7), or a `.local` name — checked by spelling in JS and then, in Java, on **every
  address the name resolves to**; the connection goes to the address that was checked.
- **What was not loosened.** Android's network security config can only name domains, not address
  ranges, so "cleartext to private ranges only" cannot be written there, and turning cleartext on
  would open it for every HTTP stack in the app. So the app's cleartext policy stays as it was (none),
  the WebView's mixed-content rule stays as it was, and the plugin speaks RFC 6455 itself over a plain
  socket (`LocalWebSocket.java`, no OkHttp), only to checked addresses. Its handshake sends
  `Origin: https://localhost`. `wss://` on Android is the WebView's own WebSocket, as on the web.
- **iOS**: `wss://` only for now (docs/27).

**A device on the person's home network: the host `"local"`.** A local address differs in every home,
so a shared app cannot name it. It names `"local"` instead and connects to the host `local`:

```ts
permissions: { network: { hosts: ["local"] } }
const hub = await ctx.caps.network.socket("ws://local:8123/api/websocket");
```

- The first time, Potyro asks the person for the address — “**“Lights” wants to connect to a device on
  your home network.**” *What is the device’s address? For example 192.168.1.20 or homeassistant.local —
  it is in the device’s own settings or app.* [192.168.1.20] **Continue** / **Not now** — then asks the
  consent naming it: “**“Lights” wants a live connection to 192.168.1.20 on your home network.**” Allow /
  Not now. (The shell's prompt dialog takes a detail line, button words and a placeholder for this —
  `UiBridge.prompt`; an app's own `ctx.ui.prompt` still passes only `default`.)
- Only a local address is taken (loopback, 10/8, 172.16/12, 192.168/16, link-local, IPv6 unique-local,
  a `.local` name — `parseLocalAddress`); anything else is asked again, naming what was typed.
  Cancelling is Not now (`"denied"`). A port they type wins over the app's (`homeassistant.local:9000`).
- The address is remembered for the app on this device (`local:<address>` in its answer; one home
  device per app — a new address replaces the old) and listed in Edit tile with its switch and
  **Change address**. The app's socket's `url` is the real address.
- A trusted app may use `local` too: it is asked for the address (never the consent).
- `local` is for `socket()` only (a `fetch` to `local` goes nowhere).
- **The web's limit.** An https page cannot open `ws://` to the home network (mixed content), and most
  home devices offer no `wss://` with a certificate a browser accepts. So on the website, `ws://local…`
  is refused at once with `"insecure"` — before anyone is asked for an address that could not work —
  and `wss://local…` asks with a sentence added to the question: “*In a browser it connects only if the
  device offers a secure (wss://) connection; the Potyro app for Android connects either way.*” The
  Android app reaches it over `PotyroLocalSocket`; a page served over http (development) reaches it
  directly. `SocketCap.plainLocal` says which.

`LocalWebSocket` is tested on a desktop JVM against real servers (`packages/native/test/
local-websocket.test.ts`, skipped without a JDK); the APK builds with it. It has not yet been run on a
phone against a Home Assistant.

## 7. Development and tests

- **Fakes.** `createFakeSockets()` (`@potyro/capabilities`) is the page's real `SocketCap` over a fake
  `WebSocket`: a host echoes by default; `serve(host, "refuse" | "unreachable" | handler)`,
  `setOnline(false)`, `buffered`, and the rooms relay with its real envelope (`joinRoom(id, name)` for
  another member). Unit tests: `host/test/sockets.test.ts` (mediation and limits),
  `socket-bridge.test.ts` (flow control), `sockets-runners.test.ts` (the same app, trusted, in QuickJS
  and in the realm).
- **e2e**: `e2e/sockets-{trusted,sandbox}.spec.ts` with a local echo server and the real rooms relay
  (`node --experimental-strip-types packages/rooms/src/server.ts`, started by the spec on a free port,
  letting in only the dev server's origin), two browser contexts in one room, in Chromium and Firefox.
- **A rooms relay while developing.** The dev server has nothing behind `/rooms`. Start one
  (`PORT=4215 ROOMS_ORIGINS="http://localhost:5173" pnpm --filter @potyro/rooms start`) and either
  build with `VITE_POTYRO_ROOMS=ws://localhost:4215/rooms` or, in that browser,
  `localStorage["potyro:dev:rooms"] = "ws://localhost:4215/rooms"` — read only by a development build,
  never a production one.

## 8. Open questions

Decided 2026-10-16 (owner-approved follow-ups): local addresses for shared apps (`hosts: ["local"]`,
§6), revoking (Edit tile's Live connections, §3), a longer background grace (`keepWhileHidden`, at most
15 min, §5), and network waits not counting against a sealed call's budget (§5).

- **More than one home device per app.** `local` is one address per app; an app that drives a hub and
  a speaker would need two. Not built: no app asks for it yet.
- **Concurrent calls and the paused budget.** The pause is counted per box, not per call: while one
  call waits on the network, a second call running at the same time in the same box is not charged
  either. The same is true of a question to the person, and has been since the budget was made.
