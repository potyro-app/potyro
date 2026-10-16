# 05 · Runtime Interfaces (TypeScript contracts)

The seams. `Store` and `Capabilities` are exactly what `ctx` (docs/04) surfaces to app code.
The `Host` is new: it owns loading + execution + trust. Changing any of these is a
cross-cutting event (see CLAUDE.md).

## Shared value types

```ts
export type Id = string;                       // ULID
export type Value = string | number | boolean | Date | null | Value[] | { [k: string]: Value };
export interface Record { id: Id; createdAt: string; updatedAt: string; [field: string]: unknown; }
export interface Resolved extends Record { /* relations resolved 1-level; computed accessible */ }
export interface MediaRef { key: string; mime: string; w?: number; h?: number; }
export interface Geo { lat: number; lng: number; label?: string; }
```

## Store (packages/store)

Persistence seam. `SqliteStore` (OPFS + JSON1) is primary; `MemoryStore` for tests; CRDT-backed
later. **Filtering/sorting is done by the runtime in JS over fetched rows** (personal scale) —
so the Store's query surface is deliberately simple: fetch by entity with optional cheap
indexable narrowing, not an expression engine.

```ts
export interface Store {
  open(appId: string): Promise<void>;
  close(): Promise<void>;

  // reads — return raw records; runtime resolves relations + computed + JS filters
  all(entity: string, narrow?: { ids?: Id[]; limit?: number; offset?: number }): Promise<Record[]>;
  get(entity: string, id: Id): Promise<Record | null>;

  // optional indexable fast-path (later optimization; default impl may ignore)
  byIndex?(entity: string, field: string, value: Value): Promise<Record[]>;

  // writes
  insert(entity: string, data: Partial<Record>): Promise<Record>;
  update(entity: string, id: Id, patch: Partial<Record>): Promise<Record>;
  delete(entity: string, id: Id): Promise<void>;
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;

  // reactivity — notify on entity change; runtime re-runs JS queries
  subscribe(entity: string, cb: () => void): Unsubscribe;

  // blobs (media), kv (ctx.storage), migration support
  putBlob(b: Blob): Promise<MediaRef>;  getBlob(r: MediaRef): Promise<Blob | null>;
  kvGet(k: string): Promise<string | null>;  kvSet(k: string, v: string): Promise<void>;  kvDelete(k: string): Promise<void>;
  subscribeKv?(cb: () => void): Unsubscribe;  // synced stores: a peer changed kv (KA-22 live version gate)
  subscribeBlob?(r: MediaRef, cb: () => void): Unsubscribe;  // KA-20: a photo's bytes arrived
  blobHere?(r: MediaRef): Promise<boolean>;  // #255: bytes on this device? asks no one (getBlob fetches); absent = always
  spaceUsage?(): Promise<{ used: number; budget: number }>;  // #255: a shared space's bytes on the relay vs its budget; a file write past it throws SpaceFullError
  memberIds?(): readonly string[];  // synced stores: every account ever in the space, removed ones too (KA-19)
  deleteBlob(key: string): Promise<void>;  // a replaced or removed file's old bytes
  // the app's own folder (#252): an INDEX of files by id; bytes are blobs under `entry.blob`.
  // Paths, types, hashing and "one file per path" live once in `file-space.ts` (`fileSpace(store)`),
  // so stores only keep entries. In a synced store the index syncs and bytes come on demand (#255):
  // a member has every entry, and a file's bytes only once someone on that device has read it. A
  // write replaces at the file level (last writer wins); what it replaced is kept on the entry as
  // `earlier` copies (the last 3, from the last 30 days). Entries members made at one path apart
  // read as one file, the newest, the rest its earlier copies. A synced store refuses an entry under
  // `.modules/` or `.src/`: the app's code never rides its shared space (#281).
  listFiles(): Promise<StoredFile[]>;  getFile(id: string): Promise<StoredFile | null>;
  setFile(entry: StoredFile): Promise<void>;  deleteFile(id: string): Promise<void>;
  subscribeFiles?(cb: () => void): Unsubscribe;
  // what the app declared: field types (KA-38 set merge) and who may edit what (KA-21 creatorOnly,
  // enforced by a synced store from its signed log — another member's edit to such a row does not take)
  describe?(schema: StoreSchema, rules?: { creatorOnly?: readonly string[] }): void;
  storedSchemaVersion(): Promise<number>;  runMigrations(plan: MigrationPlan): Promise<void>;
}
export type Unsubscribe = () => void;
```

Note the big simplification vs earlier drafts: **no `QuerySpec` with a `where` string, no
SQL-pushdown/residual planner.** Queries are JS predicates the runtime applies after `all()`.
The optional `byIndex` exists only as a future fast-path for hot fields; correctness never
depends on it. A CRDT `Store` implements the same interface; `subscribe` becomes its live feed.

## Capabilities (packages/capabilities)

Native-feature seam; backs `ctx.caps`. Each may be `null` when a target lacks it (runtime
degrades) or when an untrusted app wasn't granted it (host omits it — see Host below).

```ts
export interface Capabilities {
  camera: CameraCap | null;
  notifications: NotificationCap | null;
  geolocation: GeoCap | null;
  haptics: HapticsCap | null;              // vibration; null where unsupported
  filesystem: FileCap;                     // always present
  network: NetworkCap;                     // always present at platform level; gated per app by host
  liveCamera?: LiveCameraCap | null;       // getUserMedia; one session per page (docs/25)
  ai?: AiCap | null;                       // docs/23 — composed per app by the shell, not a target
  sockets?: SocketCap | null;              // docs/28 — one per page; the shell wraps it per app
  share?: ShareCap | null;                 // the device's share sheet: { canShare(p), share(p) } for the share dialog
                                           // (web: Web Share API + canShare({ files }); native: @capacitor/share)
  speech?: SpeechCap | null;               // docs/29 — the page's microphone; the shell wraps it per app
}
/** Live connections: the page owns the WebSockets (the shell's realm, never a sealed frame). */
export interface SocketCap {
  open(url: string, opts: { protocols?: string[] }, events: PlatformSocketEvents): Promise<PlatformSocket>; // rejects SocketOpenError{code}
  readonly roomsUrl?: string;              // wss://<site>/rooms (VITE_POTYRO_ROOMS overrides)
  closeAll(why: "left" | "hidden"): void;  // the shell, leaving an app; itself, after 30 s hidden
  readonly openCount: number;
  allowed?(t: SocketTarget): boolean; allow?(t: SocketTarget): void;   // per app: the person's answer, kept on the device
  consentWords?(appName: string, t: SocketTarget): AiConsentWords;     // { message; detail; ok; cancel }
}
export type SocketTarget = { host: string } | { rooms: true };
export interface PlatformSocketEvents { message(d: string | Uint8Array): void; close(code: number, reason: string, why: "app" | "server" | "network" | "left" | "hidden"): void; }
export interface PlatformSocket { readonly protocol: string; readonly bufferedAmount: number; send(d: string | Uint8Array): void; close(code?: number, reason?: string): void; }
/** One request: the host built it from an app's ctx.caps.ai call; the shell decides who pays and sends it. */
/** Voice input: one listening per page; `where` says which engine and whose service. */
export interface SpeechCap {
  where(language: string): Promise<{ engine: "device" | "browser" | "cloud"; service?: string } | null>;
  listen(o: { language: string; interim: boolean; maxMs?: number },
         ev: { onText(text: string, final: boolean): void; onWorking?(): void;
               onEnd(e: { why: SpeechEndWhy; text: string; code?: SpeechFailure; message?: string }): void }): Promise<{ stop(): void; abort(why: SpeechEndWhy): void }>;
  stopAll(why: SpeechEndWhy): void;  readonly listening: boolean;
  withTranscriber?(t: { service: string; transcribe(wav: Blob, language: string): Promise<string> }): SpeechCap; // the cloud engine
  allowed?(engine): boolean; allow?(engine): void; consentWords?(appName: string, where): AiConsentWords;   // per app, the shell's
}
export interface AiCall { system: string; parts: Array<{ text: string } | { image: Blob } | { audio: Blob }>;
                          json?: Record<string, unknown>; maxTokens: number; }
export interface AiReply { text: string; via: "free" | "own-key"; cost?: number; }
export interface AiCap {
  readonly service: string;                 // "OpenRouter", named in the consent question
  readonly language?: string;               // the person's own; what the model writes in
  complete(call: AiCall): Promise<AiReply>; // throws words for the person: offline, off, nobody pays
  standing?(): "on" | "off" | undefined;    // this app's answer on this device
  allow?(): void;
  consentWords?(appName: string, sends: "photo" | "text"): AiConsentWords | Promise<AiConsentWords>; // { message; detail; ok; cancel }, saying who pays now
}
export interface CameraCap { capture(o?: { source?: "camera"|"library" }): Promise<Blob>; }
export interface LiveCameraCap {
  start(o?: LiveCameraOptions): Promise<LiveCamera>;   // LiveCamera is the app-facing handle (docs/04)
  current(): LiveCamera | null;                        // what is running, for the shell's indicator
  subscribe(fn: (on: LiveCamera | null) => void): () => void;
  stopAll(why: LiveCameraStop): void;                  // the shell: leaving an app, "Turn off"
  useFaces(loader: FaceLoader | null): void;           // the shell's face finder, for live({ faces }) (docs/25 §Faces)
}
export type FaceLoader = () => Promise<FaceFinder>;    // loads once per page; rejects with code "unsupported" | "failed"
export interface FaceFinder {                          // one call at a time per session; frames skip while it runs
  find(video: HTMLVideoElement, time: number, opts: { max: number; points: boolean }): Promise<Face[]>;
}
export interface NotificationCap {
  schedule(n: { id: string; at: string; title: string; body?: string }): Promise<void>;
  cancel(id: string): Promise<void>; list(): Promise<{ id: string; at: string }[]>;
  supportsExactScheduling: boolean;
}
export interface GeoCap { current(): Promise<Geo>; }
export interface FileCap { pick(): Promise<Blob>; save(name: string, data: Blob): Promise<void>; }
export interface NetworkCap { fetch(input: string, init?: RequestInit): Promise<Response>; }
export interface HapticsCap { vibrate(pattern?: number | number[]): Promise<void>; }  // Web Vibration-style
```

Implementations: `WebCapabilities`, `CapacitorCapabilities`, `FakeCapabilities` (tests; `FakeAi`
scripts an AI service).

`ai` is the one member no target implements: it is not a device feature. The shell composes one per
app (`app-ai.ts`, `capsForApp`) — the free relay first, then the person's own OpenRouter key — and
the host turns it into `ctx.caps.ai` (`host/src/ai.ts`: the shape check, the prompt, the answer's
validation, the pictures read from the app's own store; `mediate.ts`: the sealed app's consent and
everyone's off switch). The host never sends anything and the shell never sees a shape.

`sockets` is ONE object per page too (`sharedWebSockets()`; the fake is `createFakeSockets()`, a server
in memory with an echo, refusals and the rooms envelope). The page owns every WebSocket, so the sealed
frame — which connects nowhere, and would send `Origin: null` — never does; leaving an app closes them
all. The host's `sockets.ts` is the mediation for every app (the manifest's hosts and `rooms`, the
question once per app and host, 4 per app, 1 MiB a message, 1 MiB waiting each way), and
`socket-bridge.ts` carries a sealed app's connections into its box: four ops (`caps.network.socket`,
`.room`, `.socket.send`, `.socket.close`), a `{ t: "sock" }` message per event and a `sockack` for
each one the app takes — at most 64 events / 1 MiB untaken in the box, then the connection closes
`"slow"`. The Android app adds ws:// to the local network through its own plugin (docs/28 §6).
`open(url, { protocols, keepWhileHiddenMs })` gives each connection its own background grace
(`HIDDEN_CLOSE_MS` unless asked, at most `HIDDEN_KEEP_MAX_MS`); `plainLocal` says whether this page can
open ws:// to the home network. The shell's per-app wrapper adds, beside `allowed` / `allow` /
`consentWords`: `turnedOff` and `onTurnedOff` (Edit tile's switches: off ends that target's
connections at once, `why: "off"`), `localAddress` and `localAddressWords` (`hosts: ["local"]`). A
`SocketTarget` is `{ host } | { rooms: true } | { local: address }`.

`speech` is ONE microphone per page (`sharedWebSpeech()`, or `speechOverPlugin` in the Android app;
the fake is `createFakeSpeech()`). It picks the engine (docs/29 §2), and where the browser has none
the shell's per-app wrapper (`app-speech.ts`) adds the cloud engine with `withTranscriber`, writing a
16 kHz WAV down through the app's own AI service (`AiCall` with one `{ audio }` part). The host's
`speech.ts` is the mediation for every app (the manifest's `speech`, the question once per app and
way of listening, the limits) and `speech-bridge.ts` carries a sealed app's listening into its box:
two ops (`caps.speech.listen`, `.stop`) and a `{ t: "speech" }` message per event; a listening that
is on pauses the box's call budget like a question.

`liveCamera` is ONE object per page (`sharedLiveCamera()`), not one per `Capabilities`: the shell's
indicator watches it, and a second instance (the Studio's preview builds its own capabilities) would
be a camera the indicator could not see. It stops itself when the page is hidden or goes away. The
host puts it on `ctx.caps.camera.live` for trusted apps only (docs/25); `createLiveCamera(deps)` takes
every browser dependency as an argument, which is how its tests run without one.

Faces: the capability owns the rule (one find in flight per session, every frame carrying the latest
faces, `facesFailed` on a loader or finder that fails) and the arithmetic (`faceFrom`: the landmarker's
raw mesh → `Face`); the SHELL owns the finding (`packages/shell/src/faces/`: MediaPipe's Face
Landmarker in a worker, loaded from files the shell serves itself) and hands it over with `useFaces` at
boot. `createFakeLiveCamera({ faces })` scripts faces for tests; `sketchFace` draws a believable one
(with a `matrix` that `projectFacePoint` takes back onto its nose). `facesTime` is the session's: the
time of the frame the last answered find started on. `sameFrame` uses the `grab` dependency (a full
`ImageBitmap` of the frame, taken in the same task as the find) and hands frames on only from the
find's answer; `graphics` is read once per page (`graphicsOf`, a throwaway WebGL context).

## Host (packages/host) — loading, execution, trust  **[central, new]**

Turns an app module into something the runtime can call, choosing the runner by provenance and
building the mediated `ctx`.

```ts
export type Provenance = "trusted" | "untrusted";

export interface LoadedApp {
  definition: AppDefinition;               // the declarative parts (entities/pages/…)
  provenance: Provenance;
  permissions: PermissionManifest;
  // invoke app-provided functions, in the correct runner (direct, or sealed: the realm / the isolate):
  callComputed(entity: string, key: string, record: Resolved, ctx: Ctx): Promise<Value>;
  callAction(entity: string, key: string, record: Resolved, ctx: Ctx, input?: unknown): Promise<void>;
  callFilter(viewId: string, record: Resolved, ctx: Ctx): Promise<boolean>;
  callBinding(ref: BindingRef, record: Resolved, ctx: Ctx): Promise<Value>;
  // Page summary aggregates (docs/03 `Page.summary`). The only call taking the whole row set:
  // `computed` is per-record, so a figure over the WHOLE set cannot be a per-record binding.
  // It is a host call because for an untrusted app the function never leaves the sealed box —
  // the extracted definition carries the `__potyro_fn__` sentinel where the function was.
  callSummary(pageId: string, index: number, rows: Resolved[], ctx: Ctx): Promise<Value>;
  // A function inside a page's view, over its rows, named by path (#109): "series" of a chart,
  // "items.2.value" / "items.2.compare.value" of a stats view. Own keys and indexes only.
  callFold(pageId: string, path: string, rows: Resolved[], ctx: Ctx): Promise<Value>;
  // A field's `default` when it is a function of ctx (KA-25) — evaluated where the function lives,
  // since an untrusted app's definition holds only the sentinel string where it was.
  callFieldDefault(entity: string, field: string, ctx: Ctx): Promise<Value>;
  // The app's live launcher tile (docs/04 §Tile): what `tile(ctx)` returns, or null without one.
  // Through the host for the same reason: a sealed app's tile runs in its box; only data comes out.
  callTile(ctx: Ctx): Promise<Value>;
  reminderWhen(id: string, record: Resolved, ctx: Ctx): Promise<Date | null>;
  customView(viewId: string): CustomViewComponent | null;   // trusted only; see note
  customViewMount?(viewId: string): CustomViewMount | null; // trusted only, the `mount` form
  // A sealed app's custom view, drawn in a sandboxed frame of its own (#267): the realm's apps only.
  sealedView?(pageRef: string): SealedView | null;
  dispose(): void;
}

export interface Host {
  load(source: AppSource): Promise<LoadedApp>;               // AppSource = module ref | bundle text | url
  // builds the ctx handed to app fns, applying trust mediation to caps. `language` is the one the
  // app's words are shown in (from the runtime, #302) and `formatLocale` the tag ctx.format uses:
  makeCtx(app: LoadedApp, base: { store: Store; caps: Capabilities; ui: UiBridge; nav: NavBridge; params?: Record<string, unknown>;
                                  language?: Language; formatLocale?: string }): Ctx;
  promote(appId: string): Promise<void>;                     // untrusted → trusted (user action)
}
```

Runner behavior:
- **trusted** → module is imported directly; `call*` invoke the real functions; `customView`
  returns the real React component; `ctx.caps` are unmediated.
- **untrusted** → the module bundle runs in a **browser realm** (#272, docs/22, docs/07): a Worker
  inside an opaque-origin sandboxed iframe, `@potyro/host/realm`'s `createRealmLoader`, plugged in
  as `loadIsolated` exactly where the isolate was. `call*` post the record, the params and the plain
  half of `ctx` (`CtxBase`) into the Worker, where the app's own function runs with a `ctx` proxy,
  and a structured-clone value comes back. Every `ctx` member that reaches the store, a capability,
  the person or the shell is an op on the app's MessagePort; the host checks it against `OPS` and
  the ctx ids it issued and then calls that method on the `ctx` `buildCtx` made — so `mediateCaps`,
  the values gate and authorship are the trusted path's own, never a copy. `ctx.caps` are the
  mediated wrappers for granted permissions only; with the realm, `network.fetch`, `camera`,
  `filesystem`, `media.put` and `files.bytes` cross as themselves (Blobs, bytes, a `Response`),
  which the isolate could not carry. `caps.ai.extract` / `caps.ai.ask` (docs/23) are two more ops:
  a picture crosses as a Blob, a reference as its plain fields; the isolate carries bytes as base64.
  The QuickJS-WASM isolate (`@potyro/host/isolate`) is the
  fallback behind a flag (docs/07) and still runs verification until docs/22 phase 2.
- **Hard limits (realm).** A per-call deadline (1 s, paused while a question, a dialog, a consent
  prompt, a fetch or an AI request waits), a 100 ms heartbeat from the Worker (1 s of silence stops it), and a
  flood guard (more than 2,000 messages in 50 ms). A stop tears the realm down and rejects what was
  waiting with the reason; the next call starts a fresh realm. There is no per-Worker memory cap
  (QuickJS's did not hold either, docs/22 §6.1); what crosses `ctx` is what is capped
  (`FORMAT_LIMITS`). A realm that cannot start at all is a `RealmStartError`, and the shell falls
  back to QuickJS for that session.

**Words and formats (#302).** `ctx.locale`, `ctx.t` and `ctx.format` are built from one module,
`packages/host/src/format.ts` — `Intl` with cached formatters, and `intl-messageformat` for ICU
messages, which interprets a message rather than compiling it to code and is loaded lazily, before
`load` returns. The realm bundles the same `format.ts` and formats with the browser's own `Intl`, in
the language and locale each call's `CtxBase` carries — no round trip. The QuickJS isolate has no
`Intl`: each call's payload carries the language, so `ctx.locale` and `ctx.t(words)` are answered
inside the box, and `ctx.t(words, vars)` and `ctx.format.*` reach the host through a second VM
function beside `__hostSync` (QuickJS only; it goes when the isolate does):

```ts
__hostPure(requestJson: string): string   // synchronous; "+" and the text, or "!" and why
```

It is authority-free — `Intl` and the ICU formatter over the arguments given, no store, cap or
person — which is why it may be synchronous inside a `filter`. The host checks the operation
(`date|number|money|relative|list|t`), keeps only the allow-listed options, caps sizes (1,000 list
items, 10,000 characters), and formats in its own locale; host time counts against the call's
deadline. `mediate.ts` is unchanged: formatting is not a capability. `ctx.ui` takes `Words`
everywhere it takes words, and `ctx` resolves them before the `UiBridge` sees them, so the shell only
ever renders strings (`ShownUiItem`, and form fields as `Localized<Field>`). `UiBridge.share`
(`ctx.ui.share`) receives `ShownShare` — `{ text?, url?, title?, app? }` — already checked: something
to send, an http(s) link only, at most 10,000 characters — and answers whether it was copied or handed
to the share sheet; a headless bridge leaves it out and `ctx` answers `false`. `app` is
`{ page, params }`, a link to one of the app's own pages that the shell makes (docs/24 §11): the page is
one the app declares and the params are only those its `link.params` names, text of at most
`LINK_LIMITS.chars` (`checkLinkRequest`, from `potyro`; a mistake throws in the app's action). The app
never sees the address. The shell's bridge (`createUiBridge(…, makeLink)`) opens the share dialog at
once and puts the link in when it is made; a bridge with no `makeLink` (the Studio's preview) sends the
words alone. An `AppPackage` carries the app's `line` (`manifest.json`), which is what such a link
matches on the receiving device.

Custom views from **untrusted** apps (#267, owner decision 2026-10-16, docs/22 §11). Policy —
**a shared app's custom views run in the sealed box, on every engine, behind a watchdog**; they
never run in the shell's realm.

- **Where.** One sandboxed frame per mounted view (`sandbox="allow-scripts"`, srcdoc, the realm CSP,
  WebRTC deleted first), in the place the shell gives the view: the shell keeps the chrome and the
  navigation, the frame is as wide as the content area and exactly as tall as the room below it,
  down to the shell's bottom bar (a taller view scrolls inside it, so a bar the view fixes to its
  bottom stays on screen). It is its own frame, not the logic's,
  so a stuck view goes without the app's logic, a second view is not frozen with it, and its
  document goes with every unmount.
- **What runs.** `RealmLoadedApp.sealedView(pageRef)` → `SealedView` (`state`, `retry`, `mount`).
  The view bundle is the same source as the logic's, bundled again with React resolved to the
  frame's own (`bundleViewSource`); the frame runtime (`virtual:potyro-realm-view`, React inside)
  evaluates it and mounts `mount(el, props)` or `render(props)`.
- **What it reaches.** `ViewProps.runtime.ctx` is the realm's ctx proxy: every op goes through the
  same `answer`/`route` table as the logic's, on a fresh mediated ctx per op (as a trusted view's
  `runtime.ctx` is fresh per access), so `mediateCaps`, the values gate and authorship are the
  same calls — host-side a view's op and the logic's cannot be told apart. The `Runtime` members that
  are not ctx (`watchQuery`, `watchRecord` and the hooks over them, `runAction`,
  `reconcileReminders`) and the `navigate` prop are `VIEW_OPS`, accepted on a view's port only.
  File and picture URLs cross as bytes; the frame makes its own URLs. `ctx.caps.camera.live` is not
  there (trusted only for now).
- **Theme.** Every custom property where the view sits, its colour scheme, font and ink, sent at
  mount and again when the theme changes.
- **Freezes.** A watchdog pings the view every 250 ms: unanswered for **2 s** (a frame out of
  process — desktop Chromium) or the page's own check **2 s** late while the view shows (a frame
  sharing the page's thread — Firefox, WebKit, Chromium without site isolation) takes the view down;
  the page then shows the app's plain version with a calm notice and "Try its screen again". A
  crash-loop guard writes a marker before every mount; a marker left stale by a tab that froze or
  died turns that app's views off on the device until the person asks, so an endless loop can freeze
  Potyro at most once per app. After a silent stop, a realm frame that does not answer means the
  stuck view still holds Chromium's shared sandbox process: every realm is restarted so it exits.
- **Where views cannot run sealed** — the QuickJS fallback, and the Studio's preview, which still
  previews in QuickJS — the page says the screen runs only as yours and offers the trust dialog (in a
  demo link, "Keep this app" first).

**Before #267, that policy kept shared apps' views off — and that used to make shared apps useless,
which it no longer did since KA-24.** A shared app's main
screen is typically an *aggregate* — "who owes whom", "what's still to buy" — and `computed` is
per-record, so aggregates had no declarative home and had to be custom views. A friend's app
therefore arrived untrusted (correctly) and rendered its whole point as a blank rectangle, whose only
remedy was promoting a stranger's code to ambient authority: the capitulation the isolate exists to
prevent.

The **`aggregate` view type** closes that. Its `rows(rows, ctx)` fold is ordinary TypeScript — the
arithmetic is not restricted in any way — but it RETURNS DATA, so it crosses into the sealed box
exactly as `computed`/`filter`/`sort`/`binding`/`summary` already do, and the screen renders
identically at both provenances. Only the *rendering* is declarative, never the thinking.

This was chosen over DOM-sandboxing on the evidence of the bridge itself: it is a single
string-in/string-out JSON function, so value-returning functions cross natively while a React
component would need a serializable-VDOM plus an event-callback protocol that does not exist.
A DOM-sandboxing strategy remains the long-term answer for genuinely bespoke UI — it is no longer
load-bearing for sharing.

**Contained failures are reported, not thrown (#262).** A `computed` that throws shows as empty and
its page still loads; the console says so once per session. Whoever has to know every time — the
Studio, running a candidate app before it ships — listens:

```ts
export interface AppFailure { app: string; what: string; message: string } // what: "computed meal.kcal"
export function onAppFailure(listener: (f: AppFailure) => void): () => void; // returns unsubscribe
export function activeFailureListeners(): number; // for tests: a run must leave none behind
```

Listening changes nothing about the containment; a listener that throws is ignored.

**A failure stays where it happens (#271).** Every part of an app is code that can throw — on data
it did not expect, or in the sealed box on a feature it does not have — and one part failing fails
only that part. Each is reported under a name in the app's own terms:

| `what` | Contained by | What the person sees |
|---|---|---|
| `computed meal.kcal` | host/resolve.ts — the value is empty | nothing but the empty value: every record still shows. No alert — it would take the place of a view that works to tell the person using the app about code they cannot fix. Whoever checks the app hears it here (the Studio's run of a change); the console says it once |
| `page today` | runtime/watch.ts — the page's filter, sort or query | where its rows would be: "… its records could not be listed: …" |
| `view today#1` | views `PartBoundary`, around each view a page shows | in that view's place: "… it could not be shown: …"; the views beside it and every other page carry on |
| `action meal.log`, `page action today[0]` | runtime `runAction` / `runPageAction` | a toast, as before |

A library that throws while it loads takes the module with it: the bundle is one script, so there is
no smaller part to fail. The Add-an-app card's test load is what catches that, before install.

## Runtime API (packages/runtime) — what views consume

```ts
export interface Runtime {
  definition: Localized<AppDefinition>;                  // in the person's language: every Words slot a string (#302)
  language: { current?: Language; default?: Language; available: Language[] };
  ctx: Ctx;                                              // full host surface (trust-scoped)
  useQuery(entity: string, spec?: { filter?: (r: Resolved) => boolean; sort?: (a: Resolved, b: Resolved) => number }):
    { rows: Resolved[]; loading: boolean };
  useRecord(entity: string, id: Id): { record: Resolved | null; loading: boolean };
  runAction(entity: string, key: string, id: Id, input?: unknown): Promise<void>;
  create(entity: string, data: Partial<Record>): Promise<Record>;
  patch(entity: string, id: Id, data: Partial<Record>): Promise<void>;
  remove(entity: string, id: Id): Promise<void>;
  reconcileReminders(): Promise<void>;
  // #302: the person's languages changed — localize again, re-run every watcher, re-title reminders.
  setLanguages(prefs: readonly string[]): boolean;
  onLanguageChange(cb: () => void): () => void;
  // #271: this app's contained failures (above), and a way for a view to report its own.
  onFailure(cb: (f: AppFailure) => void): () => void;
  reportFailure(what: string, error: unknown): void;
}
```

Views call this; never Store/Capabilities/Host directly. Computed values on `Resolved` are
produced by the runtime via `host.callComputed` and memoized per query pass. A computed written
`{ value, label }` (#310) runs its `value`, in both runners (`computedRun`; the harness the same).

**Language (#302, docs/20 §3).** `createRuntime` takes the person's languages (`RuntimeDeps.languages`:
their explicit choice alone, or the device's list) and picks the app's (`pickLanguage`). The
definition views read is `localize(app.definition, language)` — the raw one stays on `LoadedApp` —
so views only ever see strings; a `Dynamic<Words>` option (`emptyText`, a page `title`) that returns a
map is resolved the same way. Every ctx it builds carries `language` and `formatLocale`. An app that
declares no language is shown as written. The only view-side addition is option `labels`: an enum or
tags value reads as `labels[option] ?? option` on boards, pills, buttons, chips and headings. And a
key's heading (`fieldLabel`: a detail row, a table column) is the field's `label`, else the computed's
`label` (#310), else the key humanised. A key's value (`shownValue`: a detail row, a table cell, a
badge, a group heading) is an option's `labels` entry, a computed's `labels` entry, or a computed's
`format` message formatted with `runtime.ctx.t` over the value's properties — else the value.

## View contract (packages/views)

```ts
export interface ViewProps<Opts = unknown> {
  runtime: Runtime;
  entity: string;
  options: Opts;                          // the view's declarative bindings (functions resolved by runtime)
  param?: Record<string, string>;
  navigate: (pageId: string, param?: Record<string, string>) => void;
}
export type ViewComponent = React.FC<ViewProps>;
export interface ViewRegistration { type: string; component: ViewComponent; requires?: FieldConstraint; }
```

The `custom` view type is registered like any other; its component simply delegates to the
app-provided `customView` (trusted apps), or mounts the sealed app's `sealedView` into a place it
sizes and shows the plain version when that view is stopped or off (`views/src/custom.tsx`, #267).

A view's full-screen layer (a form sheet) is portalled to `usePortalRoot()`, which is
`document.body` unless a host frames the app in a screen of its own (`PortalRootContext`, #261):
the Studio shows an app beside its conversation, and the app's forms belong to that screen, not
to the page. Popovers anchored to a control keep the page — they are placed by page coordinates.

A view that lists records reports how many it shows through `PageCountContext` (`useReportCount`),
which the shell's page header provides; the header never runs the page's query a second time to
count. Inside a page `layout` the items report to nobody (`null` provider) except a `split`'s list.
The views also export the presentation helpers the shell's header shares with them: `backdropOf` /
`backdropImage` / `backdropKind` / `pageOf` (a page's ground) and `usePictureUrl` (a photo, a file,
or a path in the app's files, as a URL).
