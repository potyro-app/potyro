---
title: ctx.caps.network
description: fetch for requests, socket for a live connection to a server, and room for a room on Potyro's relay.
section: reference
order: 6
---

# ctx.caps.network

`ctx.caps.network` is how an app reaches the internet: `fetch` for a request, `socket` for a live
connection to a server, and `room` for a room where every member hears the others.

```ts
const net = ctx.caps.network!;

const res = await net.fetch("https://api.example.com/rates");
const rates = await res.json();

const s = await net.socket("wss://stream.example.com/prices", { protocols: ["v1"] });
s.onMessage((d) => void ctx.create("tick", JSON.parse(String(d))));
s.onClose(({ why }) => ctx.log("closed", why));

const room = await net.room();           // a new room; share room.id
await room.send(JSON.stringify({ stroke }));
room.onMessage((d) => draw(JSON.parse(String(d))));
```

## Permission

```ts
permissions: { network: true }                                   // any host, and the rooms
permissions: { network: { hosts: ["api.example.com", "hub.example.org:8443"] } }
permissions: { network: { hosts: ["local"], rooms: true } }      // a home device, and the rooms
```

| | Your own app | A shared (sealed) app |
|---|---|---|
| Hosts | any | only those in `permissions.network.hosts`; a host without a port matches any port |
| Potyro's rooms | yes | with `rooms: true` or `network: true` |
| Question | none | once per app and host, or once for the rooms, on this device |
| The answer | — | kept per app on this device; **Not now** is never kept; forgotten when the app is deleted |
| Turning it off | — | Edit tile → **Live connections**: one switch per host; off closes open connections with `"off"` and refuses new ones without asking |

A sealed app asking for a host it did not declare is refused at once with `"not-allowed-host"`.
Nobody is asked. `{ rooms: true }` alone allows no other host, for `fetch` either.

## `fetch(input, init?)`

```ts
fetch(input: string, init?: RequestInit): Promise<Response>
```

The web's `fetch`, with the same `Response`. In a sealed app the host must be in
`permissions.network.hosts`. The host `local` is for `socket()` only.

## `socket(url, opts?)`

```ts
socket(url: string, opts?: SocketOptions): Promise<Socket>
```

Resolves once the connection is open, so `readyState` starts `"open"`. Rejects with an `Error`
whose `code` is a `SocketFailure`. A bad address or a scheme other than `ws`/`wss` is a `TypeError`:
a bug in the app, not something to word for the person.

### Options

| Option | Type | Notes |
|---|---|---|
| `protocols` | `string \| string[]` | subprotocols to offer, in order |
| `keepWhileHidden` | `` `${n}s` \| `${n}m` `` | how long the connection survives Potyro being hidden; default 30 s, at most 15 min |

### `Socket`

| Member | Type | Notes |
|---|---|---|
| `url` | string | the address connected to |
| `protocol` | string | the subprotocol the server chose, or `""` |
| `readyState` | `"open" \| "closing" \| "closed"` | |
| `send(data)` | `(data: string \| Uint8Array) => Promise<void>` | resolves once the message is on its way; rejects with a `SocketSendFailure` |
| `onMessage(cb)` | `(data: string \| Uint8Array) => void` | every message, in order; returns the unsubscribe |
| `onClose(cb)` | `(close: SocketClose) => void` | once, when it ends, however it ends; called at once if it already has |
| `close(code?, reason?)` | | code 1000 unless given; `onClose` hears `why: "app"` |

Text arrives as a string, binary as bytes. Messages that arrive before `onMessage` is called are
held and handed to the first callback.

Inside a callback `ctx` still works: write what arrives as records and every view follows. But
`ctx.now()` is the time of the call that opened the connection. Use `new Date()` for when a message
came. Keep the socket in a module-level variable: it outlives the action that opened it.

### Why `socket()` or `room()` rejects

| `code` | What happened |
|---|---|
| `"offline"` | the device has no connection |
| `"denied"` | the person said Not now; asked again next time |
| `"refused"` | the server said no or closed at once |
| `"unreachable"` | no answer within 15 s |
| `"not-allowed-host"` | a sealed app asked for a host it did not declare |
| `"insecure"` | `ws://` where only `wss://` can work |
| `"too-many"` | this app already holds 4 connections |
| `"hidden"` | Potyro is in the background; nothing opens there, try again later |
| `"off"` | the person turned this host off in Edit tile; do not retry |

### Why `send()` rejects

| `code` | What happened |
|---|---|
| `"closed"` | the connection is not open |
| `"too-big"` | one message over 1 MiB (64 KiB in a room) |
| `"full"` | more than 1 MiB is still waiting to go out; slow down |

### `SocketClose`

```ts
{ code: number; reason: string; why: SocketCloseWhy }
```

`code` is the WebSocket close code: 1000 normal, 1006 dropped without a close frame, 4000–4999 the
server's own.

| `why` | What happened |
|---|---|
| `"app"` | the app closed it |
| `"server"` | the server closed it; `code` and `reason` say why |
| `"network"` | the connection dropped |
| `"left"` | the person left the app |
| `"hidden"` | Potyro was in the background for 30 s, or for `keepWhileHidden` |
| `"too-big"` | the server sent one message over 1 MiB |
| `"slow"` | messages piled up faster than the app took them |
| `"stopped"` | the sealed app's box was stopped |
| `"off"` | the person turned it off in Edit tile; do not retry |

### Limits

| | |
|---|---|
| Connections per app | 4, sockets and rooms together |
| One message | 1 MiB |
| Waiting to go out | 1 MiB |
| Connecting | 15 s, then `"unreachable"` |
| Hidden | closed after 30 s; `keepWhileHidden` up to 15 min |

### Reconnecting

Potyro never reconnects by itself. A reconnect is a new connection: a new member id in a room, and
a server's subscriptions must be sent again. Decide it in `onClose`:

```ts
let live: Socket | null = null;
let wait = 1000;

async function connect(ctx: Ctx): Promise<void> {
  try {
    live = await ctx.caps.network!.socket(URL);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "denied" || code === "not-allowed-host" || code === "insecure" || code === "off") return;
    setTimeout(() => void connect(ctx), (wait = Math.min(wait * 2, 30_000)));
    return;
  }
  wait = 1000;
  await live.send(JSON.stringify({ subscribe: "prices" }));
  live.onMessage((d) => { /* … */ });
  live.onClose(({ why }) => {
    if (why === "network" || why === "server" || why === "hidden") setTimeout(() => void connect(ctx), wait);
  });
}
```

While Potyro is hidden every try rejects with `"hidden"` at once and costs nothing. The first try
after the person comes back opens. After `"left"`, wait for the person to open the app again.

### `ws://` and `wss://`

| Where | What connects |
|---|---|
| The web | `wss://` only, plus `ws://` to the device itself (`localhost`, `127.0.0.1`, `::1`) |
| The Android app | the same, plus `ws://` to the local network: `10/8`, `172.16/12`, `192.168/16`, link-local, a `.local` name |
| A page served over plain http (development) | any `ws://` |

Anything else is refused with `"insecure"` before anyone is asked.

### A device on the home network: the host `local`

A local address differs in every home, so a shared app cannot name it. It names `local`:

```ts
permissions: { network: { hosts: ["local"] } }
const hub = await ctx.caps.network!.socket("ws://local:8123/api/websocket");
```

The first time, Potyro asks the person for the address, then for consent naming it. Only a local
address is accepted. A port the person types wins over the app's. The address is remembered for
the app on this device, one per app, and `socket.url` is the real address. Your own app may use
`local` too; it is asked for the address only. On the website `ws://local…` is refused with
`"insecure"`; `wss://local…` connects only when the device offers it.

## `room(id?, opts?)`

```ts
room(id?: string, opts?: RoomOptions): Promise<Room>
```

A room on Potyro's relay. Without `id` it makes a new room. Rejects like `socket()`.

### Options

| Option | Type | Notes |
|---|---|---|
| `name` | string | what the others see; display only, at most 40 characters; none unless given |
| `keepWhileHidden` | as for `socket` | |

### `Room`

Everything on `Socket`, and:

| Member | Type | Notes |
|---|---|---|
| `id` | string | 22–64 characters of `A–Z a–z 0–9 _ -`; anyone with it can join |
| `me` | `{ id, name }` | you, as the others see you; `id` is new on every connection |
| `members` | `readonly { id, name }[]` | everyone else here now, oldest first; kept current |
| `onPresence(cb)` | `({ type: "join" \| "leave"; member }) => void` | someone came or went; returns the unsubscribe |

The id is the invitation: put it in a share link with `ctx.ui.share`. Never derive one from
something guessable.

`onMessage` hears the other members' messages exactly as they sent them, never your own. No message
says who sent it. Put `room.me.id` in your messages if that matters, and treat it as the sender's
own claim. A text message may not begin with `{"potyro-rooms":`; that is a `TypeError`.

### Limits

| | | Past it |
|---|---|---|
| One message | 64 KiB | the sender is closed, code 1009 |
| Members in a room | 16 | the newcomer's `room()` rejects with `"refused"` |
| Messages per connection | 30 a second, bursts of 60 | closed, code 4004 |
| Bytes per connection | 64 KiB a second, bursts of 256 KiB | closed, code 4004 |
| A room where nobody sends | 30 minutes | everyone is closed, code 4007 |
| Queued for a member that is not reading | 1 MiB | that member is closed, code 4006 |

A relay close reaches `onClose` as `why: "server"` with its code. A room exists while it has
members; the last one out ends it.

What fits: strokes, cursor positions, chat lines, a game state of a few KB. What does not: files,
photos, video. Those belong in `ctx.files` and sync. Batch pointer moves into one message per
animation frame.

### What the relay does not do

- **Keep history.** A late member gets the member list, not what was said. Have the oldest member
  answer a `join` with the current state.
- **Know anyone.** No accounts, no passwords. The id is the only key.
- **Read or log messages.** Frames are checked for size and rate and passed on.
- **Encrypt end to end.** The connection is TLS, but the relay could read the frames. An app that
  needs more encrypts them with a key carried in the link's fragment.
- **Verify a member.** Anyone in the room can send anything. Design so that a member who lies spoils
  only their own play.

## In a sealed app

The connection lives in Potyro's page, never in the sealed box. Events are handed into the box in
order. Time spent waiting on the network, a `fetch` or a connection opening, does not count against
a sealed call's time budget.

## Next

- [Working together](../guides/working-together.md): sharing a room's id and playing together.
- [Device capabilities](../guides/device-capabilities.md): declaring permissions and wording refusals.
- [Your apps and other people's apps](../concepts/trusted-and-sealed.md): why a sealed app is asked.
