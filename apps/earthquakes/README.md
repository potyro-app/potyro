# Earthquakes — live

Every earthquake EMSC reports, on a map the moment it is reported: the latest, the strongest of the
last day, the ones near you, and an alert when a strong one is close. Data: EMSC, CC BY 4.0.

```
earthquakes.app.ts   the app: Map, Latest, Strongest, Near me, a quake's page
feed.ts              the live side: the connection, records, the last day filled in, alerts, pruning, the demo
live.ts              keeping one live connection: back-off, the background, stopping (shared by the live apps)
quakes.ts            EMSC's messages read into quakes; strength, distance, the near-me rule, pruning
demo.ts              the demo's quakes: real events from 13–15 Oct 2026, their time moved to now
words.ts             how the feed and a quake read, in six languages
fixtures/            real messages: the live feed (`emsc-socket.json`) and the catalogue (`fdsn-recent.json`)
test/                parsing, the connection's life, and the whole feed against a scripted ctx
```

## How it works

- **The feed** is EMSC's public WebSocket, `wss://www.seismicportal.eu/standing_order/websocket`
  (docs/28): one `{ "action": "create" | "update", "data": <GeoJSON Feature> }` per new or revised
  event. A revision patches the quake it is about; an event EMSC only now catalogued from weeks ago is
  skipped. **Watch live** first fills in the last day (magnitude 3 and up) from EMSC's catalogue
  (`/fdsnws/event/1/query?format=json`), one request, only when nothing that recent is on the device.
- **The status line** at the top of Map and Latest is an aggregate view over one `feed` record the app
  keeps current: Live, Connecting, Connection lost — trying again, Paused while you were away, You're
  offline, Can't reach EMSC right now, Not allowed, the demo — each with what happens next.
- **Reconnecting** (live.ts): after a drop, 1 s, 2 s, 4 s … at most 30 s apart; after Potyro's 30 s in
  the background, every 3 s — nothing opens while Potyro is hidden (`"hidden"`, docs/28 §5), so the
  first try after the person comes back is the one that opens; after the person leaves, never.
- **Kept small**: the last 7 days and at most 1,500 quakes, the oldest first.
- **Near me**: the "Where I am" chip lists quakes within a radius; **Alerts…** turns on an alert for a
  magnitude and distance, from the device's location, asked once. On a phone it is a notification; on
  the web (no notifications there) it is said on screen. Only fresh quakes ring, never a filled-in one.
- **The demo** plays 50 real earlier quakes through the same reading: the last day at once, then one
  every 2.5 s, the last a revision. No connection, no request, no question. **Watch live** takes the
  demo's quakes away again, so what is listed from then on is real.

## Sealed and yours

Every screen is a built-in view, so a friend who opens it from a share link runs the whole app sealed.
Sealed, it reaches only `www.seismicportal.eu` (`permissions.network.hosts`), asks once before the
network ("use the network?", for the catalogue) and once before the live connection, and its buttons
start long work and return at once (a sealed box gives a call about a second). As yours, nothing is
asked. Records are added only by the feed: `quickActions: []`, so there is no add button and the map
has no place button.

## Build and check

```
pnpm --filter @potyro/app-earthquakes build      # → apps/earthquakes/dist/earthquakes.potyro-app.zip
pnpm --filter @potyro/app-earthquakes test
pnpm --filter @potyro/app-earthquakes typecheck
pnpm e2e e2e/earthquakes-trusted.spec.ts         # sealed and yours, against a local fake of EMSC
```
