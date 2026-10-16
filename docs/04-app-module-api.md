# 04 · App Module API — `defineApp` and the `ctx` surface

This is the real API of the system. "Full control" is delivered here: app functions receive
`ctx`, and `ctx` exposes everything the host can do. Enriching Potyro means enriching `ctx` —
never adding language features to a DSL (there is no DSL).

## `defineApp(def): App`

A typed builder. It (a) infers types so your `computed`/`action`/`filter` functions get fully
typed `record` and `ctx`, (b) normalizes defaults, and (c) in dev runs a Zod check over the
**declarative** parts only. It does not and must not constrain function bodies.

```ts
export default defineApp({ id, name, icon, version, schemaVersion, language, languages, theme, permissions, entities, pages, reminders, migrations });
```

`name`, `icon` (one emoji) and `theme.accent` are the app's identity: the launcher tile shows them
without running the app (they are read from the source), and falls back to a monogram of the name
in a colour derived from the app when `icon` or `accent` is absent. The tile is the accent darkened,
in OKLCH, until white text on it reaches WCAG AA (4.5:1); an accent that already does is used as
written. `category` (one lowercase word: `"games"`, `"camera"`, `"everyday"`) is where the launcher
puts the app on Start: in the group for that word, made when the first app of the kind arrives.

### Tile — the app's live launcher tile (#96)

```ts
tile?: (ctx: Ctx) => TileContent | Promise<TileContent>;

interface TileContent {               // packages/schema/src/types/tile.ts
  count?: number;                     // what is waiting: "3 to water" is 3; a small tile shows only this
  title?: Words;                      // the live face's headline
  lines?: Words[];                    // up to three short lines under it
  image?: MediaRef | FileRef | string; // a media field's value, a file field's value, or a path in ctx.files
}
```

On the Tiles home screen (a choice in Look; Classic is the default), a medium or wide tile turns over every few seconds between the app's own face (its icon and name)
and this live face — Windows Phone's live tile; a small one shows the count. The function reads the
app's data through `ctx` like any other and **returns data**, like an `aggregate`'s `rows`: a trusted
app's runs directly, a sealed app's runs in its box (`LoadedApp.callTile`, docs/05) and only the
answer comes out. Plain and serialisable on purpose — the launcher caches it beside the tile, and a
phone's home-screen widget will read the same object.

```ts
tile: async (ctx) => {
  const due = (await ctx.query("plant")).filter((p) => p.active && nextWatering(p) <= ctx.now());
  return {
    count: due.length,
    title: ctx.t({ en: "{n, plural, =0 {All watered} other {# to water}}", pl: "…" }, { n: due.length }),
    lines: due.slice(0, 3).map((p) => p.name),
    image: due.find((p) => p.photo)?.photo,
  };
},
```

When it runs: while the app is open, again a moment after any of its records changes (so home shows
what you just did); from the home screen, after the wall has painted with plain faces, for any app
whose face is missing, from another version of the app, or older than 15 minutes — opening the app's
store read-only, without showing it, one app at a time. It has 1.5 s. A tile that throws, runs out of
time, writes, or returns something that is not a tile shows the plain face, silently: no toast, no
error. The launcher keeps what it can show (`checkTileContent`: a whole count up to 9,999, a title up
to 60 characters, three lines of 80, a picture reference — never an address) and makes a picture
small (240 px) before keeping it.

### How it looks — presentation options (all optional)

`theme.background` / a page's `background` (`"wash"` default · `"dots"` · `"grain"` · `"plain"` · `{ image: "<path in ctx.files>" }`),
a page's `description` and `primaryAction` (a quick action `id`, or the index of one of its `actions`: a big
button in the page's header, no floating Add on that page), a list's `display.lead` (`"monogram"` ·
`"icon"` · `"none"`), a gallery's `aspect` (`"landscape"` · `"square"` · `"portrait"`), a detail view's
`cover` (`"banner"` · `"full"` · `"band"` · `"none"`), `media` (a photo field, or a computed returning a
path in `ctx.files`), `facts` (fields as chips on the cover) and `primaryAction` (the one big button), and
an `ActionDef`'s `icon`. They are data — the shell draws them, at either provenance — and an app that
sets none still gets a page header, rows led by their photo or a tinted initial, and a cover on every
record page (docs/03 §How a page looks). Additive: no app bumps `schemaVersion` for them.

### Related records, tappable rows, a remembering checklist (all optional)

A detail section may be `related: { entity, via, view: "list" | "timeline" | "chart", … }` instead of
`fields`; an `AggregateRow` may carry `record`, `open` and `action`; a checklist's `quickAdd` may be
`{ suggest, remember, defaults: (text, ctx) => fields }`, with `icon` and `layout: "tiles"`; and
`display.icon` gives a record its own glyph. `defaults` and any function binding in a related section
run through the host like a stats fold (`callFold` at their path), so a shared app behaves the same
(docs/03). The Studio reads these with `ctx.views`; the core prompt does not carry them. Additive: no
app bumps `schemaVersion`.

## Function signatures

```ts
type Computed<E>   = (record: Resolved<E>, ctx: Ctx) => Value | Promise<Value>;
type ActionFn<E>   = (record: Resolved<E>, ctx: Ctx, input?: unknown) => void | Promise<void>;
type FilterFn<E>   = (record: Resolved<E>, ctx: Ctx) => boolean;
type SortFn<E>     = (a: Resolved<E>, b: Resolved<E>) => number;
type BindingFn<E,T>= (record: Resolved<E>, ctx: Ctx) => T;
type ReminderWhen<E> = (record: Resolved<E>, ctx: Ctx) => Date | null;
type CustomView    = (props: ViewProps) => JSX.Element;   // full React component
```

`Resolved<E>` = the record with its `relation` fields resolved one level deep and its
`computed` values available as properties (computed are lazily evaluated + memoized when
accessed). Deeper traversal or cross-entity queries use `ctx.query`.

A `computed` entry is a `Computed` function, or **`{ value: Computed; label?: Words }`** (#310) when a
page shows it under a heading — in an entity's `groups`, a detail page's `sections`, a table's
`columns`. The views head it with its `label` in the person's language, and fall back to the key,
humanised ("Calories Per Serving"), only when there is none. Both spellings run the same, at both
provenances; `computedInfo` / `computedRun` (from `potyro`) read either, as `actionInfo` does for
actions. Additive and optional: no app bumps `schemaVersion` for it.

Its **value** reads in the person's language too, through two more optional words slots on the object
form. **`labels`**, keyed by value, is for a computed that returns one of a few keys (recipes' `diet`:
`"vegan"`, shown as a badge): the views show `labels[value] ?? value` wherever the value is written
out — a detail row, a table cell, a badge, a group heading — exactly as for an enum field, and app
functions still see the key. **`format`** is for a computed that returns an object (workout's
`lastBest`, `{ kg, reps }`, which a custom view prefills from): an ICU message, the kind `ctx.t`
takes, over the object's text, number and date properties (`{value}` for a scalar), formatted by the
host for the person: `"{kg, plural, =0 {{reps} reps} other {{kg, number} kg × {reps}}}"`. A message
that cannot be said with what the value has shows the value as before. Wording a message cannot
express is a `value` that returns the words itself (`ctx.t`, `ctx.format`).

```ts
computed: {
  calories: (r) => r.ingredients.reduce(…),                       // used only by other logic
  caloriesPerServing: {                                            // shown in "Nutrition & cost"
    label: { en: "Calories per serving", pl: "Kalorie na porcję" },
    value: (r) => r.calories / Math.max(r.servings, 1),
  },
}
```

## `ctx` — the host API surface (complete)

```ts
interface Ctx {
  // ---- data (all reads return Resolved records) ----
  query<E>(entity: string, spec?: {
    filter?: (r: Resolved<E>) => boolean;   // JS predicate, run in-memory
    sort?:   (a: Resolved<E>, b: Resolved<E>) => number;
    limit?: number; offset?: number;
  }): Promise<Resolved<E>[]>;
  get<E>(entity: string, id: string): Promise<Resolved<E> | null>;
  create<E>(entity: string, data: Partial<E>): Promise<Resolved<E>>;
  patch<E>(entity: string, id: string, data: Partial<E>): Promise<Resolved<E>>;
  delete(entity: string, id: string): Promise<void>;
  transaction<T>(fn: (tx: Ctx) => Promise<T>): Promise<T>;
  // Values are checked against their declared field (KA-21). create/patch REJECT a value that does
  // not fit (`FieldValueError`, e.g. "Amount must be a number."); a patch holds values it leaves
  // unchanged only to their shape, so an old record stays saveable after its enum options change.
  // Reads never return a value that does not fit: the record carries the last value that did (from
  // the history, on a synced store) or nothing. Same on the direct ctx and in the sealed box.
  // A `member` value in a shared app must name someone in the app when set, and someone who has ever
  // been in it when read (a ledger naming a person who left stays readable).

  // ---- time (injected once per evaluation pass for determinism) ----
  now(): Date;
  today(): Date;

  // ---- runtime inputs (view filter params, custom-view args, what a link opened the page with) — PER PAGE ----
  params: Readonly<Record<string, unknown>>;

  // ---- the app-wide selection, when the app declares a top-level `scope` (docs/03) ----
  // `ctx.scope.trip` is the current trip as a Resolved record, or undefined; `{}` without a scope.
  // Synchronous and fixed per evaluation pass, so a filter can read it. Per device, not shared.
  scope: Readonly<Record<string, Resolved | undefined>>;

  // ---- the app's words and the person's formats (#302, docs/20) ----
  // `locale` is the language the app's words are shown in — one of its `languages` — fixed per pass.
  // `t` picks a map's words for it; with `vars` the words are an ICU message (plurals agree).
  // `format` formats for the person, and works the same in the sealed box (see below).
  locale: Language;
  t(words: Words, vars?: Record<string, string | number | Date>): string;
  format: { locale: string;                            // the tag they format in: "pl-PL"
            date(d, opts?): string; number(n, opts?): string;
            money(minor: number, currency?: string): string;   // whole minor units, as a money field stores them
            relative(d, opts?: { unit?; numeric? }): string;   // from ctx.now(): "in 3 days"
            list(items: string[], opts?: { type? }): string };

  // ---- who is using this app (KA-18) ----
  // `me` is always present — a solo app gets this device's identity. `space` is absent for a solo
  // app; in a shared one it carries the members and this device's role (`invite()` is admin-only
  // and never reaches an untrusted app). Every record carries `createdBy`, stamped by the HOST on
  // create and never settable or patchable by app code, trusted or untrusted — "who is this about"
  // is a `member` field, not `createdBy`.
  me: Person;                                         // { id, name }
  space?: { id: string; role: "admin" | "writer" | "reader"; members: Person[]; invite(role?): Promise<string> };

  // ---- app-scoped key/value storage (separate from entity records) ----
  storage: { get<T>(k: string): Promise<T | null>; set(k: string, v: unknown): Promise<void>;
             delete(k: string): Promise<void>; keys(prefix?: string): Promise<string[]>; };

  // ---- native capabilities (may be denied/scoped for untrusted apps) ----
  caps: {
    camera?:        { capture(opts?: { source?: "camera"|"library" }): Promise<Blob>;
                      live?(opts?: { facing?: "user"|"environment"; width?: number; height?: number; faces?: boolean | { max?: number; points?: boolean } }): Promise<LiveCamera>; };  // trusted only, below
    notifications?: { schedule(n: { id: string; at: Date; title: string; body?: string }): Promise<void>;
                      cancel(id: string): Promise<void>; supportsExactScheduling: boolean; };
    geo?:           { current(): Promise<{ lat: number; lng: number }>; };
    haptics?:       { vibrate(pattern?: number | number[]): Promise<void>; };  // non-sensitive
    filesystem?:    { pick(): Promise<Blob>; save(name: string, data: Blob): Promise<void>; };
    network?:       { fetch(input: string, init?: RequestInit): Promise<Response>;   // gated
                      socket(url: string, opts?: { protocols?: string | string[]; keepWhileHidden?: "90s" | "5m" }): Promise<Socket>;  // docs/28
                      room(id?: string, opts?: { name?: string; keepWhileHidden?: "90s" | "5m" }): Promise<Room>; };   // Potyro's rooms, docs/26
    ai?: {                                                                  // docs/23; permissions: { ai: true }
      // Read a picture or a text into a plain shape. The answer is checked against it by the host.
      extract<const S extends AiShape>(req: { schema: S; instructions?: string;
              image?: AiImage | AiImage[]; text?: string }): Promise<AiValue<S>>;
      ask(prompt: string, opts?: { image?: AiImage | AiImage[]; instructions?: string }): Promise<string>;
    };
    // AiShape: "text" | "number" | "boolean" | "date" (each with "?" for may-be-null), { oneOf: [...] },
    // [shape], { key: shape }.  AiImage: Blob | Uint8Array | FileRef | a path | a media field's MediaRef.
    speech?: {                                                              // docs/29; permissions: { speech: true }
      listen(opts?: { language?: string; interim?: boolean }): Promise<SpeechSession>;
    };
    // SpeechSession: { language, engine: "device" | "browser" | "cloud", listening,
    //   onText(cb: (text, final) => void): () => void; stop(): void; result: Promise<string> }
  };

  // ---- media helpers ----
  media: { put(bytes: Blob): Promise<MediaRef>; url(ref: MediaRef): Promise<string>; };

  // ---- the app's own folder (#252) ----
  // A file is named by path ("notes/a.md") or by a `file` field's value (a FileRef, by id, so it
  // survives a rename). A missing path throws; `null` = bytes not on this device yet (shared app).
  files: {
    list(folder?: string): Promise<FileInfo[]>;          stat(f): Promise<FileInfo | null>;
    text(f): Promise<string | null>;  json<T>(f): Promise<T | null>;  bytes(f): Promise<Uint8Array | null>;
    url(f): Promise<string | null>;                       // for <img>/<audio>/<video>/a link
    write(path, data: string | Uint8Array | Blob, opts?: { mime?: string }): Promise<FileInfo>;  // create or replace, keeps the id
    rename(f, to: string): Promise<FileInfo>;             remove(f): Promise<void>;
    import(opts?: { folder?; accept?; multiple? }): Promise<FileInfo[]>;  // the person picks; [] on cancel
    export(f): Promise<void>;                             // save a copy outside the app
  };

  // ---- UI affordances provided by the shell (every word may be `Words`: a map shows in ctx.locale) ----
  ui: { toast(msg: Words): void;
        confirm(msg: Words, opts?: { detail?: Words; ok?: Words; cancel?: Words; destructive?: boolean }): Promise<boolean>;
        prompt(msg: Words, opts?: { default?: string }): Promise<string | null>;
        pick<T>(items: T[], opts?: { label?: (t: T) => string; multi?: boolean }): Promise<T | T[] | null>;
        sheet<T>(opts: { title?: Words; items: UiItem<T>[] }): Promise<T | null>;
        menu<T>(opts: { title?: Words; items: UiItem<T>[] }): Promise<T | null>;
        form<T>(opts: { title: Words; fields: Record<string, Field>; initial?: Partial<T>; submit?: Words }): Promise<T | null>;
        progress(label: Words): { update(fraction: number, detail?: string): void; done(): void };
        share(opts: { text?: Words; url?: string; title?: Words;
                      app?: { page: string; params?: Record<string, string> } }): Promise<boolean>; };   // true = copied / handed on
  // UiItem<T> = { id: T; label: Words; detail?: Words; icon?: string; destructive?: boolean }

  // ---- navigation (in view/action contexts) ----
  navigate(pageId: string, params?: Record<string, string>): void;

  // ---- diagnostics ----
  log(...args: unknown[]): void;
}
```

### Asking the person (`ctx.ui`, #112)

Every `ctx.ui` call takes plain data and gives plain data back, so an untrusted app asks exactly
what a trusted one does, with no permission prompt — none of them reach outside the app.

| Call | Phone | Wide screen |
|---|---|---|
| `confirm(msg, { detail, ok, destructive })` | bottom sheet; the button says `ok` ("Delete"), in the danger colour when `destructive` | small centred dialog, same button |
| `sheet({ title, items })` | bottom sheet | small centred panel |
| `menu({ title, items })` | bottom sheet | hangs under the button that ran the action (a centred panel when there is none) |
| `form({ title, fields, initial, submit })` | full-screen form sheet | centred form |
| `progress(label)` | a bar above the tab bar | a bar at the bottom centre |
| `share({ text, url, title })` | dialog showing what will be sent: **Share…** (the system sheet) and **Copy** | the same dialog; **Copy** (and **Share…** where the browser has one) |

- **Items.** A `destructive` item is always shown last, after a separator, in the danger colour —
  whatever order the app listed it in. Arrow keys, Home/End and Escape work; dismissing answers `null`.
- **Forms.** `fields` are ordinary field definitions, validated like an entity's before the form
  opens (a bad one throws in the action). They render with the record form's controls — number
  steppers with units, enum buttons, date chips, relation pickers — and required fields are checked
  the same way. The answer is the raw values: a relation's id, a number as a number.
- **Progress.** `update(fraction, detail?)` moves the bar (`detail` replaces the percentage, e.g. "24 of
  40"); `done()` removes it. It is announced as a progress bar.
- **Share.** For a result, a message or a link the person sends on themselves ("Daily #12 4/6" and its
  grid; an invite from `ctx.space.invite()`). They choose where it goes — the share sheet or the
  clipboard — so it needs no permission and works the same sealed. `url` must be http(s), `text` at
  most 10,000 characters; the answer is `true` once it was copied or handed on. **`app`** instead of
  `url` is a link to one of this app's own pages — see "Params from links" below.
- **Untrusted apps.** A question does not hold the sealed box: while a form is open the page keeps
  rendering, and the call's time budget pauses until it is answered.

These are new optional members: no existing app changes, so `schemaVersion` (the app's own data
version) is not bumped.

### Params from links (docs/24 §11)

A link can open an app at one of its pages, with `ctx.params` filled in: "Invite friends" in a game
sends a link that opens its Play page with the game's code in the box. The page says what a link may
hand it, and the app asks for the link through the share dialog:

```ts
pages: [{ id: "play", title: "Play", link: { params: ["code"] }, view: { type: "custom", entity: "game", mount } }],

// in an action or a custom view
await ctx.ui.share({ title: "Play with me", text: `Or type the code ${code}`, app: { page: "play", params: { code } } });

// on the Play page, on the friend's device
const code = props.param?.code;            // a custom view (ViewProps.param); a filter reads ctx.params.code
```

- **Who it opens for.** The person's own copy of the app when they have one — any copy, whatever it is
  called on their device — else the demo the link carries, which opens on that page and lands there
  again once they keep it (and after "run it as mine" reloads it). A link to an app they do not have
  never installs anything.
- **What the page gets.** Only the names in `link.params`, each a string of at most
  `LINK_LIMITS.chars` (200) characters, at most `LINK_LIMITS.params` (8) of them. Anything else in a
  link — another name, a longer value, a page the app does not have — is dropped, silently: anyone can
  write a link. Without `link`, a link can open the page with nothing.
- **What it never does.** A link only opens a page and hands it text. Nothing runs because of it: the
  game fills in the code and waits for Join. Treat the values as what they are — something a stranger
  may have typed.
- **Making one.** `app.page` must be one of the app's pages and every param one it declares, as text
  within the cap; otherwise `ui.share` throws, in the action, saying what to declare. The app never
  sees the address — the shell makes it, so a sealed app can invite people too, revealing nothing but
  the params. `url` and `app` are one or the other.

`link` is a new optional page member and `app` a new optional `share` option: no app changes, and no
`schemaVersion` moves.

### An app's words in several languages (#302, docs/20)

Every declarative slot a person reads takes **`Words`**: a string, the same in every language, or a
map, `{ en: "Quantity", pl: "Ilość" }`. That is entity and field labels, help, placeholders and
units, page, group, section and layout titles, empty texts, chart and aggregate titles, button,
action, summary, stat, chip and quick-action labels, a computed's `label` (#310), `labels` and
`format`, the scope's label
and the app's `name`. An
`enum` or `tags` field gains **`labels`**, keyed by option: the option is what records store and
never changes by language; only its words do. The list exists once, in the Zod schema (`zWords` at
each slot), and one walker derived from it does the checking and the resolving.

- **`language: "en"`** says which language the app is written in, and **`languages: ["en", "pl"]`**
  every language it carries, its own first. Every map must contain `language`; a key that is not in
  `languages` is an error (it is almost always a typo). A map missing one of the *other* languages is
  not: that string falls back to the app's own language, so a newer copy with more languages still
  loads on an older one.
- **Resolution** is the person's explicit choice, else the device's languages in order; for each, the
  exact tag, then the same base language; else the app's own. It happens once, in the runtime
  (`localize`), so views read plain strings. `Runtime.definition` is the localized definition.
- **Inside functions**, `ctx.t({ en: "Due now", pl: "Do podlania" })`; with `vars`, ICU plurals:
  `ctx.t({ en: "{n, plural, one {# plant} other {# plants}}", pl: "…" }, { n })`. Records are never
  translated: `ctx.t({ en: "Water {name}", pl: "Podlej: {name}" }, { name: p.name })`.
- **Formats** — `ctx.format.date/number/money/relative/list` — are for text the app composes. Return a
  `Date` or a number where a view formats it (a `datetime` field, a `money` column,
  `AggregateRow.value`). `ctx.format.locale` is the person's locale when it speaks the words'
  language ("en-GB" for an English app: 13/10/2026), else the words' language.
- **Old apps** (no `language`) are shown exactly as written, and `ctx.locale` is the person's language.

These are optional, additive members, and no record changes: a translation moves `version`, never
`schemaVersion`, and needs no migration. Adding a language is the Studio's `translate` tool (docs/20
§5.1); the structural editor (below) edits a translated label one language at a time.

### The live camera (`ctx.caps.camera.live`, docs/25)

For camera toys — stickers that follow a face, mirror effects, pose games. `live()` starts the
camera and resolves to a handle a custom view draws from:

```ts
interface LiveCamera {
  readonly video: HTMLVideoElement;  readonly stream: MediaStream;   // playing, muted, not in the page
  readonly width: number;  readonly height: number;  readonly facing: "user" | "environment";
  readonly active: boolean;
  onFrame(cb: (video: HTMLVideoElement, info: { time: number; width: number; height: number; faces?: Face[]; facesFailed?: "unsupported" | "failed" }) => void): () => void;
  snap(opts?: { type?: string; quality?: number }): Promise<Blob>;   // the current frame
  onStop(cb: (why: "app" | "person" | "hidden" | "closed" | "ended" | "replaced") => void): () => void;
  stop(): void;
}
```

One session per device: a second `live()` replaces the first (that is how to flip cameras). Frames are
not mirrored. A failure rejects with an `Error` whose `code` is `"denied" | "missing" | "busy" |
"hidden" | "failed"`. The **shell** shows a "Camera on" indicator with **Turn off** while it runs —
the app cannot hide it — and the camera **always stops** when the page is hidden, when the person
leaves the app, or when the device ends it; it never restarts by itself (`onStop` says why, the app
offers to resume). Frames go nowhere unless the app passes them to a capability that sends.

**Faces** (`live({ faces: true })`, docs/25 §Faces): each frame's `info.faces` holds the faces Potyro
found in it, on the device — per face its `box`, `eyes.left`/`eyes.right` (centre, pupil, outline,
width, `open`), `mouth` (corners, top, bottom, outlines), `nose`, `brows`, `expressions` (`mouthOpen`,
`jawOpen`, `smile`, `blinkLeft`, `blinkRight`, `browUp`, `browDown`, `pucker`, `puff`, each 0–1) and
`turn` (`roll`, `yaw`, `pitch`, radians). Points are in the video's pixels, not mirrored; left and right
are the person's own. `faces: { max: 2, points: true }` finds up to four faces and adds all 478 mesh
points. Where faces cannot be found `info.facesFailed` says why and the camera carries on. The types
(`Face`, `FaceEye`, `FaceExpressions`, `FacePoint`, `FaceOptions`, `FacesFailure`) are exported by
`potyro` from `types/faces.ts`, which sits outside the model's reference (#341).

**Trusted apps only, for now.** In a shared app `live` is `undefined` (its logic runs in the browser
realm, which has no surface to draw on and no streaming op; docs/25 has the reasons and the path).
`permissions: { camera: true }` covers both `capture()` and `live()`.

### Live connections (`ctx.caps.network.socket` / `.room`, docs/28)

For things that change while you look — a price, a home hub's sensors, a game with friends. A
`Socket` is open when `socket()` resolves; it carries text (a string) and bytes (a `Uint8Array`) both
ways, and every app holds at most 4:

```ts
let prices: Socket | null = null;   // module level: it outlives the action that opens it

actions: [{ label: "Follow BTC", run: async (ctx) => {
  try {
    prices = await ctx.caps.network!.socket("wss://stream.binance.com:9443/ws/btcusdt@trade");
  } catch (e) {
    ctx.ui.toast((e as { code?: string }).code === "offline" ? "You're offline" : "Couldn't connect");
    return;
  }
  prices.onMessage((d) => { if (typeof d === "string") void ctx.create("tick", { price: Number(JSON.parse(d).p) }); });
  prices.onClose((c) => ctx.ui.toast(c.why === "left" ? "" : `Stopped: ${c.why}`));
} }],
// permissions: { network: { hosts: ["stream.binance.com"] } }   // a host without a port: any port
```

`send(data)` resolves once the message is on its way and rejects with a `code` — `"closed"`,
`"too-big"` (over 1 MiB; a room's 64 KiB) or `"full"` (1 MiB still waiting to go). `onClose` hears
`{ code, reason, why }`, `why` being `"app" | "server" | "network" | "left" | "hidden" | "too-big" |
"slow" | "stopped" | "off"`. A refused connect rejects with a `code`: `"offline" | "denied" | "refused" |
"unreachable" | "not-allowed-host" | "insecure" | "too-many" | "hidden" | "off"` (`"off"`: the person
turned it off in Edit tile — do not retry). **Potyro closes every connection when
the person leaves the app or Potyro has been in the background 30 s (`keepWhileHidden: "5m"` asks for
longer, at most 15 min — for a chat), and never reconnects by itself**
(docs/28 §5 has the five-line reconnect pattern); nothing opens while it is in the background
(`"hidden"`), so an app that tries again every few seconds picks up when the person comes back. Messages that arrive before `onMessage` are held and
handed to the first callback. Inside a callback `ctx` works; `ctx.now()` is the opening call's time.

Records only a feed writes — the ticks above, a quake list — are marked on their entity with
`editableBy: "app"` (docs/03): no built-in view or form then offers people Add, Edit or Delete for
them, nor ticks, drags or renames them in place, while `ctx.create`/`patch`/`delete` and the app's
actions go on writing them. Leave it off for records people manage themselves, even when an action
adds them (Word Watch's watched words).

`room(id?, { name })` joins a room on Potyro's own relay (docs/26) — no address to know: `room()` makes
a new id (put it in a share link), `room(id)` joins one. `room.me`, `room.members` (the others, oldest
first, kept current) and `onPresence(e => …)` (`{ type: "join" | "leave", member }`) come from the
relay's envelope; `onMessage` hears only the other members, exactly as they sent it. A shared app
needs `permissions: { network: { rooms: true } }` (`{ rooms: true }` alone allows no other host).

The same API for every app; what differs is authority (below). A shared app reaches only the hosts it
declares — any other is refused at once, nobody asked — and is asked once per app and host on this
device: "“Price Board” wants a live connection to stream.binance.com." ("…to Potyro’s rooms." for a
room). The socket is the shell's, never the sealed frame's: messages cross the realm's port and the
QuickJS bridge (bytes as base64 there). Plain `ws://` works only where it can: the device itself, a
page served over http (development), and the Android app to the local network (docs/28 §6). A
device on the person's home network, whose address differs in every home: declare `hosts: ["local"]`
and connect to `ws://local:<port>/…` — Potyro asks the person for the address once and names it in the
question (docs/28 §6). A new optional member: no app's `schemaVersion` changes.

### Voice input (`ctx.caps.speech`, docs/29)

Live words as the person speaks, in their language:

```ts
let heard: SpeechSession | null = null;   // module level: Stop is another action

actions: [
  { label: "Dictate", run: async (ctx) => {
    heard = await ctx.caps.speech!.listen();             // resolves once the microphone is on
    heard.onText((text, final) => { /* everything so far: show it as it is */ });
    void heard.result.then((text) => ctx.create("note", { text }),
                           (e) => ctx.ui.toast(e.code === "denied" ? "Allow the microphone to talk to it" : "It stopped"));
  } },
  { label: "Stop", run: async () => heard?.stop() },
],
// permissions: { speech: true }
```

Do not await `result` inside the action that started it: while an action runs, the app's other
buttons wait, so Stop could never be pressed. `listen({ language: "pt-BR" })` listens in another
language; `interim: false` hands over finished sentences only. Failures carry a `code`: `"denied" |
"unavailable" | "offline" | "failed"`. A listening ends on `stop()`, a pause, leaving the app, Potyro
hidden, a new listening, or 5 minutes (1 for the cloud engine). Where the words are made —
`engine` — is the device's own recognizer where it has one, else the browser's speech service
(Chrome's is Google's), else (Firefox) a recording written down by an AI service; the question says
which. A shared app is asked once per app and way of listening: "“Pantry” wants to listen to you
through the microphone."; the person's own app only when the recording would leave the device. A new
optional member: no app's `schemaVersion` changes.

### How `ctx` differs by trust

`ctx` is constructed by the **host** (docs/07). Its data/time/storage/ui/nav members are always
present. Its `caps` members are:

- **Trusted app (your own):** all real, unmediated. `ctx.caps.network.fetch` hits the network,
  `filesystem` is the real FS, etc. No prompts.
- **Untrusted app (shared/imported):** each cap in the app's `permissions` manifest is either
  denied (member is `undefined`) or granted after a **one-time user consent prompt**, and when
  granted is a **mediated** wrapper (e.g. `network` may be domain-scoped, `filesystem` limited
  to an app-private area). App code sees the same interface; the authority behind it differs.

`ctx.files` is not a cap. The folder belongs to the app and nothing else sees into it, so reading
and writing it needs no permission. `import` and `export` open the system's file dialog, where the
person chooses every file; that choice is the consent, so they work the same in the sealed box. Bytes
cross the browser realm as themselves (a `Uint8Array`, a `Blob`); the QuickJS fallback carries them
across its JSON bridge as base64.

`ctx.caps.ai` (docs/23) is a cap like the others, with two differences a person can see. A sealed
app is asked about once per app on this device, in words that name the service and what goes
("“Receipt Split” wants to send a photo to an AI service (OpenRouter) to read it."), and the answer
is kept; and AI can be turned off per app in Edit tile — which holds for trusted apps too, since it
is the person's money and their photos. Only what a call names is sent: there is no ambient context,
so an app's records reach a model only if its code passes them. The answer of `extract` is
validated against the shape on the host before the app sees it (once more on a mismatch, then an
error). Failures are errors whose message is for the person: offline, turned off, "Free AI isn't
available yet — add your own key in Model settings". The call goes through the realm and the
QuickJS isolate unchanged (`caps.ai.extract` / `caps.ai.ask` ops; bytes as base64 in QuickJS), and
its wait does not count against the call's time budget. A new optional member: no app's
`schemaVersion` changes.

This is the entire safety model. The language is full JS; `caps` is where power is governed.

`ctx.locale`, `ctx.t` and `ctx.format` are not caps either. A shared app's logic runs in a browser
realm (#272, docs/07): a Worker with the browser's own `Intl`, where the host's `format.ts` is bundled
in, so `ctx.t` and `ctx.format` answer there, in the locale the host chose, with no round trip — and
so does the app's own `Intl`, `URL` or `TextEncoder`. In the QuickJS fallback, which has no `Intl`,
`ctx.locale` and `ctx.t(words)` without `vars` are answered inside the box; `ctx.t(words, vars)` and
`ctx.format.*` go to the host through one synchronous, authority-free call, `__hostPure`: it formats
the arguments it is handed — no store, no cap, no person — with an allow-listed set of options, size
limits, and the host's locale, never the app's. The same code formats for a trusted app, so a date
reads identically at every provenance (a parity test holds it, against both sealed runners).

## `ViewProps` (what a custom view receives)

```ts
interface ViewProps {
  runtime: Runtime;                 // useQuery/useRecord/runAction + ctx access
  entity: string;
  param: Record<string, string>;    // e.g. { recipeId }
  navigate: (pageId: string, params?: Record<string, string>) => void;
}
```

A custom view is a normal React component. It can call `props.runtime.ctx` for the full `ctx`,
render anything, keep local state, and use hooks. There is no ceiling — if a screen needs
bespoke logic, it's just a component.

The shell lays some of its own chrome over the app's screen, and says how much as CSS custom
properties a custom view reads instead of guessing:

| Property | What it is |
|---|---|
| `--k-chrome-bottom` | The room the shell's tab bar (and the phone's gesture bar) takes at the bottom. A view with its own bottom bar sits above it: `bottom: var(--k-chrome-bottom, 0px)`. |
| `--k-chrome-top` | The room the shell's chrome takes at the top of the app's screen, under its top bar — the "Camera on" sign while the live camera runs (docs/25), `0px` otherwise. A stage with something of its own at its top (a badge, a score) keeps it below: `padding-top: var(--k-chrome-top, 0px)`. It changes while the view is open; a view that sizes itself in script measures again when it does. |

## Design rules for `ctx`

- **Everything the host can do reaches app code only through `ctx`.** No app function imports
  `Store`/`Capabilities` directly.
- **`ctx` members are stable, minimal, and composable.** Add a member only when app code
  genuinely needs a host power it can't compose from existing members.
- **Async by default** for anything touching storage/caps; the runtime awaits.
- **Deterministic time**: `now()` is fixed per evaluation pass so computed values are stable
  within a render.

## The Edit-mode boundary (what an AI edit can and cannot reach)

"Fix with AI" rewrites the app module and nothing else. So a complaint about how a **built-in view
behaves** — when it loads, how it frames itself, what it does between renders — is not the app's to
fix, no matter how the request is phrased.

That has to be sayable. If the only legal reply to an edit request is updated source, an
unreachable request comes back as a confident change to whichever function looked closest; the
comment it writes to justify itself becomes the *input* to the next attempt, and one wrong guess
survives round after round.

So the contract (`buildModifyMessage` / `parseModifyReply` in `packages/generator`) is a **ladder**
the model works down, stopping at the first rung that fits:

1. **Declare it** with the built-in views and options — the schema's own type declarations are in
   the prompt verbatim (`reference.generated.ts`, regenerated from `packages/schema/src/types` and
   checked by a test), so "this option does not exist" is something to read, not assume. Since
   #341 the prompt carries the core of them; each capability (`ctx.caps.*`, `ctx.files`, `ctx.ui.share`…)
   is one index line, its declarations a `lookup` away and put beside a request that names it
   (`CAPABILITIES` in `packages/generator/src/reference.ts`). Since #370 so are the rarer views and
   options, by how often apps use them: `board`, `timeline`, `stats` (and a page's `summary`), `chart`,
   `steps`, `aggregate`, the checklist's drag-and-rename options, `mount`, `scope`, `sources`,
   `ctx.ui.form`/`sheet`/`menu`/`progress` and the permission manifest. A new feature gets an index
   line there; the core's budget is not raised for it.
2. **A `custom` view** when no built-in fits — the person's own app runs trusted.
3. **The doable parts**, as SEARCH/REPLACE edits, with the rest listed under **`Not done:`** in the
   prose (carried as `notDone`, shown in the Studio, filed as diagnoses). A request is never refused
   because one part of it cannot be done.
4. **`NOT-IN-APP: <what host behaviour is responsible, and what would have to change there>`** —
   only when no part can be done. No code.

With a chat engine the Studio runs this as an **agent loop** (`runModifyLoop`, `start-modify.ts`)
rather than one turn: the model has `lookup` (the real declaration of a type, option or ctx member),
`check` (bundle + validate a candidate) and `example`; every candidate must compile, validate and
keep the app's entities and pages; and a `NOT-IN-APP` sent without a `lookup` or `check` behind it
is sent back to the tools once. One-shot engines (`claude -p`, on-device) keep the one-turn guard.

Supporting this:

- The prompt carries the **declarable surface of the view the user pointed at**, taken from
  `VIEW_FIELDS` (derived from the Zod schemas, so it cannot drift from what is enforced).
- The prompt carries **what was already tried** on this app and **what was already diagnosed**, so a
  repeated complaint escalates instead of producing a third rewrite of the same function.
- **Reasoning goes in the version's `rationale`, not in source comments.** A causal claim in a
  comment is unverifiable and is read as fact by the next edit.
- A diagnosis records **no version** (nothing changed) and is stored separately
  (`app-diagnoses.ts`), shown in the History panel and fed back into later prompts.

A diagnosis is also the best backlog signal there is: it names something an app wanted to express
and could not. Per CLAUDE.md, the answer to a real gap is a wider declarative surface or a cleaner
`ctx` — not a permanent "no". `map`'s `camera` field exists because of exactly such a gap.

## Direct structural edits (no model in the loop)

A label, a field's order, whether a field appears in the form, a page's name — these are
**declarative data**, so they need no intelligence, and routing them through the agent is where the
cost/risk is worst: a minute of waiting and a whole-file rewrite to change six characters.

`app-source.ts` edits them directly. The load-bearing decision:

> **Parse for positions; splice text; never reprint.**

Parse-mutate-print reformats the whole file and mangles comments. The source here is versioned and
diffed, so a label change that reflows 300 lines makes History useless. `@babel/parser` is used
*only* to find byte ranges and `magic-string` splices them, so everything outside the edited range is
byte-identical by construction rather than by a printer's best effort. Both are lazy-loaded (~85 kB
gz together), like MapLibre.

The panel's controls are rendered from what `inspect()` could actually **locate**, never from the
schema — so a control exists only when there is a real byte range behind it, and the panel cannot
offer a change it is unable to make. An app that builds its fields from a helper, a spread, or a
computed key has no literal to edit; `inspect` says so, naming the reason, and the change routes to
the agent instead. Same honesty as the `NOT-IN-APP` boundary above.

Two hazards worth knowing about:

- **`hidden` is not "remove".** It only affects the create/edit form. A field still named in a view's
  `display` or a detail `section` keeps showing there, so the control says "hide from the form".
- **Reordering can rename your records.** `displayFieldFor` falls back to the *first* field, so
  moving a field to the top would silently change what every list row and relation picker shows.
  The editor pins `displayField` explicitly before a reorder that would change it.

Direct edits are still validated and still written to history — as `adjusted` rather than `edited`,
because reviewing a whole-file agent rewrite and reviewing a one-line structural change are very
different jobs.
