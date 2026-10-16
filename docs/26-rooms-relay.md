# Rooms: a relay for real-time multiplayer apps

Status: built (`packages/rooms`), **not deployed yet** — see docs/16 "Rooms for multiplayer apps".
Owner decision 2026-10-15: apps get WebSockets through `ctx.caps.network.socket(url)` (built:
docs/28, which also gives apps `ctx.caps.network.room(id)` over this relay), and real-time multiplayer apps — the first is a draw-and-guess game
whose rooms are joined by a share link — need a server nobody has to run themselves. This is that
server. The socket capability will point here; this document is what an app author needs.

It is deliberately small and boring: a room is a set of open websockets, and whatever one of them
sends, the others get. The relay keeps nothing, reads nothing, and knows nobody.

## 1. Joining a room

```
wss://apps.vaz.io/rooms/<roomId>?name=<display name>
```

- **`roomId`**: 22–64 characters of base64url (`A–Z a–z 0–9 _ -`). The app makes it: 128 random
  bits, which is 22 characters (`newRoomId()` in `@potyro/rooms` shows how). **Anyone who has the
  id can join** — there are no accounts and no passwords; the share link that carries the id *is*
  the invitation. Never derive an id from something guessable (a name, a date, a counter).
- **`name`** (optional): shown to the others in presence events. Self-chosen, not unique, not
  verified; the relay drops control and direction characters, collapses whitespace and keeps at
  most 40 characters. Display only — never use it to decide who someone is.

A room exists while it has members. The first person in creates it; when the last one leaves it is
gone, along with everything about it.

## 2. What you receive: peer messages and server events

Every frame another member sends arrives **exactly as they sent it**: text stays text, binary stays
binary, the bytes are not touched, and the order of one sender's frames is kept. The relay never
sends your own frames back to you.

The relay also writes a few frames of its own — the **envelope**. They are always **text** frames
that begin with exactly these 16 characters:

```
{"potyro-rooms":
```

and no member is allowed to send a text frame that begins with them (the relay closes it with 4005).
So telling them apart is one test, and it cannot be forged by a peer:

```ts
ws.onmessage = (e) => {
  if (typeof e.data === "string" && e.data.startsWith('{"potyro-rooms":')) {
    const event = JSON.parse(e.data);   // from the relay
    // event.type: "welcome" | "join" | "leave"
  } else {
    // from another member, as they sent it
  }
};
```

Test the **prefix**, not the parsed JSON: a peer may well send `{ "potyro-rooms": 1, … }` with a
space in it, and that is a peer message (the relay lets it through, because it does not begin with
the exact characters). Binary frames are never from the relay.

### The events (version 1)

The number after `"potyro-rooms":` is the envelope's version, `1` today. A change to the shape of an
event bumps it; a new optional field does not. Ignore event types you do not know.

**`welcome`** — the first frame you get, before any peer message:

```json
{"potyro-rooms":1,"type":"welcome","room":"<roomId>",
 "you":{"id":"k3J9xQ2mZp1a","name":"Ana"},
 "members":[{"id":"Qw8…","name":"Bo"},{"id":"Zr2…","name":""}],
 "limits":{"messageBytes":65536,"membersPerRoom":16,"messagesPerSecond":30,"bytesPerSecond":65536,"idleMs":1800000}}
```

`members` is everyone else in the room, oldest first (so the first one is a natural host for a game
that needs one). `limits` are the ones this relay enforces — read them rather than hard-coding them.

**`join`** — someone else came in: `{"potyro-rooms":1,"type":"join","member":{"id":"…","name":"…"}}`

**`leave`** — someone else went (closed, dropped, or was closed by the relay):
`{"potyro-rooms":1,"type":"leave","member":{"id":"…","name":"…"}}`

### Member ids

The relay gives every **connection** a random id (12 characters). It is new every time you connect —
a reconnect is a new member — and the relay, not the member, writes it, so the ids in `welcome`,
`join` and `leave` can be trusted. **Peer messages carry no sender**: the relay passes them on as-is.
If your app needs to know who sent something, put your own `you.id` in your messages — and know that
it is the sender's own claim, as is everything in a peer message. Anyone in the room can send
anything; design the game so that a member who lies spoils only their own play (e.g. the drawer
holds the word, and guesses are checked by the drawer's device, not by the guesser's).

## 3. Limits and close codes

| Limit | Default | Past it |
|---|---|---|
| One message, text or binary | 64 KiB | closed with **1009** (message too big); nothing of it is relayed |
| Members in one room | 16 | the newcomer is closed with **4002** "room full" |
| Rooms one address is in at once | 8 | closed with **4003** "too many rooms from this address" |
| Connections from one address | 64 | closed with **4003** |
| Messages per connection | 30/s sustained, bursts of 60 | closed with **4004** "too many messages" |
| Bytes per connection | 64 KiB/s sustained, bursts of 256 KiB | closed with **4004** |
| A room where nobody sends anything | 30 minutes | every member closed with **4007** "room idle" |
| Queued for a member that is not reading | 1 MiB | that member is closed with **4006** "not reading fast enough" |
| Rooms / connections on the whole relay | 2000 / 5000 | the newcomer is closed with **1013** "relay busy, try again later" |

Other closes:

| Code | Reason | What to do |
|---|---|---|
| 1001 | relay restarting | reconnect after a moment (a new member id) |
| 4001 | bad room id | a bug in the app: the id is not 22–64 base64url characters |
| 4005 | reserved prefix | a bug in the app: it sent a text frame starting with `{"potyro-rooms":` |
| 1006 | (no close frame) | the network dropped, or the relay stopped hearing from you — reconnect |

The relay **pings** every member every 30 seconds; one that has not answered the previous ping is
dropped and the others get its `leave`. Browsers answer pings on their own, so an app does nothing.
A phone that goes to sleep stops answering: expect a `leave` for it, and a fresh `join` when it comes
back.

The numbers are the defaults; the operator may change them (docs/16). The `welcome` says what is in
force.

What fits: a drawing stroke every 50 ms from every player in a full room is far under the limits; a
chat, a game state of a few KB, cursor positions at 20 a second all fit. What does not: files,
photos, video — those belong in the app's files (`ctx.files`) and sync, not in a room. Batch
high-rate input (pointer moves) into one message per animation frame or two.

## 4. What the relay does and does not do

- **No persistence.** Nothing is written to disk. A member who joins late gets the member list, not
  the history: if the game needs state for latecomers, the members already there send it (e.g. the
  oldest member answers a `join` with the current round).
- **No accounts, no authentication of members.** The room id is the only capability. Treat it like
  a link to a shared document.
- **No reading, no logging of payloads.** Frames are checked for size, rate and (text only) the
  reserved prefix, written to the other sockets, and dropped. The relay logs its own start and stop,
  never a payload, a room id, a name or an address.
- **Not encrypted end-to-end.** The connection is TLS to the server, but the relay process sees the
  frames it forwards (it just does not look). An app that needs the relay itself unable to read its
  messages encrypts them with a key carried in the share link's fragment, which never reaches a
  server — the same idea as Potyro's sync.
- **Origin check.** Browsers may connect only from the origins the operator lists (by default the
  site, `https://apps.vaz.io`, and the Android app, `https://localhost`, plus `capacitor://localhost`
  for an iOS build). A request without an `Origin` header (not a browser) is allowed: anything that
  is not a browser can claim any origin anyway, so the check only stops other websites from using the
  relay through their visitors' browsers.

## 5. Notes for the socket capability

Built as described (docs/28): `ctx.caps.network.room(id?)` opens `<roomsUrl>/<id>?name=` from the
shell, reads the envelope with `readServerEvent`, and gives the app `me`, `members` and
`onPresence`, with peers' frames as plain messages. What was written for it:

- **Open the socket from the shell's realm, not from the sealed app's frame.** A shared app's logic
  runs in an opaque-origin sandboxed iframe (docs/22); a websocket opened there sends
  `Origin: null`, which this relay refuses by default (allowing `null` would allow every sandboxed
  page on the web). The host should own the `WebSocket` and hand the app messages over its port, as
  the other mediated capabilities do — which also lets it scope the URL to this relay.
- **Split the two kinds of frame for the app.** With the prefix test above, the capability can
  surface `welcome`/`join`/`leave` as typed events and peer frames as plain messages, so app authors
  never write the prefix test themselves. `@potyro/rooms` (`isServerEvent`, `readServerEvent`, the
  types) is browser-safe and depends on no Potyro package, for exactly that.
- **The basic-auth gate** on `apps.vaz.io` covers `/rooms/` for the site (same origin: the browser
  replays the credentials on the upgrade), but not for the Android app, which is another origin
  (docs/16).
