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

`name`, `icon` and `theme.accent` are the app's identity: the launcher tile shows them
without running the app (they are read from the source), and falls back to a monogram of the name
in a colour derived from the app when `icon` or `accent` is absent. An `icon` — the app's, an
entity's, a page's, an action's, a `ui.sheet` item's, a `display.icon` per record — is the **name of
a Lucide icon** (`"shopping-cart"`, kebab-case as on lucide.dev; #425, DESIGN.md §3.5): the shell
draws it in the system's stroke wherever it shows it (a tab, a tile, a row's lead, a button, the
share image), from one lazy chunk of paths that the service worker precaches. Lucide's older names
(`"edit"`, `"home"`) still resolve. An icon may also be a **picture**: a file the app ships
(`icon: "icon.svg"`, `"art/logo.png"` — a path in its own folder, reached through `ctx.files`), an
inline `<svg>…</svg>` string, or a `data:image/…` URL (the last two live in the source, which is what
a generated app can carry; at most 64 KB). A picture is shown as it is, through `<img>` or drawn on a
canvas — never inserted as markup, so nothing in it runs, sealed or not; the SVG text is cleaned of
scripts, handlers and outside references besides. The launcher keeps a small copy of a shipped
picture once the app has opened, for the Home card, the splash and the share card. An emoji from
before keeps working, as the character it is; a name Lucide does not have, or a picture that cannot
be reached, shows the monogram (or nothing, where there is no name to make one from).

The shell makes the rest of an app's identity from these (DESIGN.md §8.5, #424): while the app is
open the browser tab carries its name and a **favicon** — a circle of its colour with its initial —
and a demo link's **share image** (1200×630) is its name in the display face, a block of its colour
on the right third with its icon on it, and the seal. An app someone else made (sealed, or kept or
remixed from a link with its credit) wears the **"Made with Potyro" seal** at the foot of every page,
the logo's symbol with its stroke in the nearest colour the logo sheet has, leading to potyro.com;
the shell draws it outside the app's code. `theme.accent` is the colour the Studio chooses by the
prompt's colour word or the app's subject (§8.3), never Potyro's own pink. `theme.appearance`
(`"light"` · `"dark"` · `"system"`, the default) is the app's own theme (§8.2, #423): while it is
open the page wears it, whatever the device's Look says; the Studio shows it in the phone frame
alone and lets the person choose it per app on their device, which wins over the declared one. The tile is the accent darkened,
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
    title: ctx.t("{n, plural, =0 {All watered} other {# to water}}", { n: due.length }),
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

### Demo — what a demo link plays (docs/24 §3)

```ts
demo?: (ctx: Ctx) => void | Promise<void>;
```

Every shared link opens the app as a working demo, on its sample records: for most apps the
`seed.json` in the package is the whole demo. An app that lives on a feed cannot be shown by records
written in advance — an earthquake from last week is not "in the last 24 hours" — so it declares
what to **play** instead: the shell calls `demo(ctx)` once the demo records are in, where the app
runs (`LoadedApp.callDemo`, docs/05), and does not wait for it. A replay goes on in the background
like one of the app's actions; Earthquakes, Word Watch and Ticker hand it the same function their
"Demo" button runs. It runs only for a demo link, never for a copy someone keeps or adds: those start
as the app starts for anyone, with the sample records if the card kept them.

### How it looks — presentation options (all optional)

`theme.background` / a page's `background` (`"wash"` default · `"dots"` · `"grain"` · `"plain"` · `{ image: "<path in ctx.files>" }`
— a picture is the page's ground, faded behind the top of the page under its content, never a block
above it), a page's `description` (where pages are listed, not on the page) and `primaryAction` (a quick
action `id`, or the index of one of its `actions`: a bar at the bottom of the screen, no floating Add on
that page; a page action's `when: (rows, ctx) => boolean` shows it only when it applies), a list's `display.lead` (`"monogram"` ·
`"icon"` · `"none"`), a gallery's `aspect` (`"landscape"` · `"square"` · `"portrait"`), `caption` (its words
under the picture, the default, or `"over"` it) and `filters` (search and chips, as a list's), a detail
view's `cover` (`"banner"` · `"full"` · `"background"` — the picture behind the whole page, the sections
read over it · `"band"` · `"none"`), `media` (a photo field, or a computed returning a path in
`ctx.files`), `facts` (fields as chips on the cover) and `primaryAction` (the one big button, a bar at
the bottom; the page's other actions then come after its sections), a list field's `lines` (its rows
read as lines of these sub-fields: `["quantity", "unit", "ingredient"]` → "350 g flour"), and
an `ActionDef`'s `icon`. A quick action is the phone's "+" in the top bar, on a page that shows its kind of record — or a
page's own `add` (the index of one of its `actions`, the app's own way in: "Add a recipe" with its
photo, paste and type), which the "+" runs instead; the
others are in the ⋯ menu, and all of them in the wide sidebar. Nothing floats over a list: a page
whose point is adding names that action as its `primaryAction`, the bar at the bottom. They are data — the shell draws them, at either provenance — and an app that
sets none still gets its content first — above a page's view there is only its `summary`, as one line
("11 to buy · 2 in the basket") — rows led by their photo or a tinted initial, and a cover on every
record page (docs/03 §How a page looks). Additive: no app bumps `schemaVersion` for them.

### Related records, tappable rows, a remembering checklist (all optional)

A detail section may be `related: { entity, via, view: "list" | "timeline" | "chart", … }` instead of
`fields`; an `AggregateRow` may carry `record`, `open` and `action` — whose `input` (plain values) is
what the row hands the action, so a row's Settle records THAT row's payment; a fold re-runs on a write
to any of the app's entities, since it may `ctx.query` the others; a `summary` figure whose value is its
own sentence ("You're owed €42") leaves out `label`; a map's `strip: true` shows the records in view as
cards along the bottom (from its `display`, nearest the middle first) — a pin brings its card instead of
a popup, a swipe moves the map, a card opens the record; a checklist's `quickAdd` may be
`{ suggest, remember, defaults: (text, ctx) => fields, usuals: (rows, ctx) => texts }` (`usuals`: what
the empty box offers as one-tap chips), with `icon`, `layout: "tiles"` and `doneLabel` (the folded
section's words under `hideDone: "collapse"`). A tap anywhere on a checklist row ticks it; dragging and
renaming wait behind its Arrange control. An app with a `scope` gets a title that switches it, with New,
Rename, Duplicate and Delete done by the shell (a copy or a delete takes the records whose single
relation points at it), and opens on the first one rather than asking; and
`display.icon` gives a record its own glyph. `defaults`, `usuals`, a page action's `when` (path `page.actions.<i>.when`) and any function binding
in a related section run through the host like a stats fold (`callFold` at their path), so a shared app behaves the same
(docs/03). The Studio reads these with `ctx.views`; the core prompt does not carry them. Additive: no
app bumps `schemaVersion`.

**A view's tap is the app's to define (2026-10-20).** Every view that opens rows takes `onOpen` as data
— `{ page, param }` — or as the app's own function, `(record, ctx) => …`, run through the host like any
binding (path `onOpen`), so a sealed app's works the same. The map view also takes `onSelect:
(record, ctx) => …` for a pin or strip card tapped, and `ctx.views.map(pageId)` gives the handler the
map back: `select(id)` brings that pin (and card) to the front and the map to it, `open(id)` opens
the record as a tap would. The view's built-in reaction stands only where the app declares nothing.
This is rule 1 (logic is functions receiving `ctx`) applied to what a view does when touched: a
request like "tapping a card should select its pin" is one line in the app, never a change to Potyro.

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
    label: "Calories per serving",
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
  // Live: the record as it is NOW — renamed, a guest added, by you or anyone in the space — not as
  // it was when it was picked; every watcher re-runs when it changes, as for a new choice. Deleted,
  // nothing is selected. (A long action that writes it back reads it with ctx.get first: its own
  // pass keeps the value it started with.)
  scope: Readonly<Record<string, Resolved | undefined>>;

  // ---- the app's words and the person's formats (#302, docs/20, docs/30) ----
  // `locale` is the language the app's words are shown in — one of its `languages` — fixed per pass.
  // `t` looks its text up in that language's catalog (locales/<lang>.po), else shows it as written;
  // `{ text, context }` tells apart one text with two meanings; with `vars` the words are an ICU
  // message (plurals agree). An app's words are written in its own `language` only — a legacy map
  // `{ en, pl }` is still read. `msg("…")` (imported from "potyro") marks words kept in a const.
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
  // Everyone a `member` field can name now: the members (just you, solo) and the guests nobody has
  // claimed (`guest: true`). Fixed per pass. Guests are placeholder people — see "Guests" below.
  people: Person[];
  guests: { add(name: string): Promise<Person>; rename(id, name): Promise<void>; remove(id): Promise<void> };

  // ---- app-scoped key/value storage (separate from entity records) ----
  storage: { get<T>(k: string): Promise<T | null>; set(k: string, v: unknown): Promise<void>;
             delete(k: string): Promise<void>; keys(prefix?: string): Promise<string[]>; };

  // ---- native capabilities (may be denied/scoped for untrusted apps) ----
  caps: {
    camera?:        { capture(opts?: { source?: "camera"|"library" }): Promise<Blob>;
                      live?(opts?: { facing?: "user"|"environment"; width?: number; height?: number; faces?: boolean | { max?: number; points?: boolean; sameFrame?: boolean; detail?: "normal" | "high" } }): Promise<LiveCamera>; };  // trusted only, below
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

  // ---- UI affordances provided by the shell (every word may be `Words`, shown in ctx.locale) ----
  ui: { toast(msg: Words): void;
        confirm(msg: Words, opts?: { detail?: Words; ok?: Words; cancel?: Words; destructive?: boolean }): Promise<boolean>;
        prompt(msg: Words, opts?: { default?: string }): Promise<string | null>;
        pick<T>(items: T[], opts?: { label?: (t: T) => string; multi?: boolean }): Promise<T | T[] | null>;
        sheet<T>(opts: { title?: Words; items: UiItem<T>[] }): Promise<T | null>;
        menu<T>(opts: { title?: Words; items: UiItem<T>[] }): Promise<T | null>;
        form<T>(opts: { title: Words; fields: Record<string, Field>; initial?: Partial<T>; submit?: Words }): Promise<T | null>;
        progress(label: Words): { update(fraction: number, detail?: string): void; done(): void };
        share(opts: { text?: Words; url?: string; title?: Words;
                      app?: { page: string; params?: Record<string, string> } }): Promise<boolean>;   // true = copied / handed on
        keepAwake(): { release(): void };                                          // the screen stays on (below)
        timer(opts: { label: Words; seconds: number; id?: string }): Promise<UiTimer>;   // a countdown the shell keeps
        timers(): Promise<UiTimer[]>;
        drawsTimer(id: string): { release(): void }; };                             // this page draws that countdown: no chip for it here
  // UiTimer = { id; label; seconds; endsAt: Date | null; left: number; paused; secondsLeft(at?): number; cancel(); pause(); resume() }
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
| `share({ text, url, title, files })` | dialog showing what will be sent (pictures previewed): **Share…** (the system sheet), **Copy**, **Save a copy** for files | the same dialog; **Copy** and **Save a copy** (and **Share…** where the browser has one) |

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
  most 10,000 characters; the answer is `true` once it was copied, saved or handed on. **`app`** instead
  of `url` is a link to one of this app's own pages — see "Params from links" below.
- **Share files.** `files: [snapBlob, record.picture, photoField]` hands pictures and files on too: a
  `Blob` or `File` the app made (`cam.snap()`, `canvas.toBlob()`), bytes, a file of the app's own
  folder (a `file` field's value, a `FileInfo`) or a `media` field's value — only this app's own. At
  most 10 files, 25 MB together; each is named (a `File`'s own name, the folder file's name, else
  `picture-1.png`, numbered when two collide). The dialog shows every one before anything leaves —
  a picture as itself, anything else by its kind, name and size — and offers **Share…** where the
  device can share those files (the Web Share API with `navigator.canShare({ files })`: Android,
  iOS, Safari, Chromium on Windows/macOS/ChromeOS; the phone app's own sheet through
  `@capacitor/share`), and **Save a copy** everywhere (a download, or the phone's Documents). Sealed
  apps the same: the person picks where it goes, so no permission — and the dialog shows exactly
  what would be sent.
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
  readonly active: boolean;  readonly graphics: "gpu" | "software" | "unknown";  // software: draw less
  onFrame(cb: (video: HTMLVideoElement, info: { time: number; width: number; height: number; faces?: Face[]; facesTime?: number; facesFailed?: "unsupported" | "failed"; frame?: ImageBitmap }) => void): () => void;
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
points (each with depth, `z`). Each face carries `matrix`, the head in 3D (16 numbers, column-major;
docs/25 maps a canonical-face point to the picture). `info.facesTime` is the time of the frame the faces
came from; `faces: { sameFrame: true }` holds each frame back until its own faces are found and hands
`info.frame`, a still of it (for warps that must not lag); `faces: { detail: "high" }` finds in the
whole picture rather than one shrunk to 640 px. Where faces cannot be found `info.facesFailed` says
why and the camera carries on. The types
(`Face`, `FaceEye`, `FaceExpressions`, `FacePoint`, `FaceMeshPoint`, `FaceOptions`, `FacesFailure`) are exported by
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

### Keeping the screen on (`ctx.ui.keepAwake`)

For a page someone follows without touching — a recipe being cooked, a workout under way:

```ts
mount(el, { ctx }) {
  const awake = ctx.ui.keepAwake();    // the screen stops dimming
  // …
  return () => awake.release();        // and may sleep again when the view goes
}
```

Holds count per app, so two views asking are one lock and the last `release()` lets go; **leaving
the app lets go of every hold**, released or not. It only stops the screen dimming while Potyro is in
front, so it needs no permission and works the same sealed. On the web it is the Screen Wake Lock,
asked for again whenever Potyro comes back to the front (the browser drops it on every glance away);
in the Android app, the window's keep-screen-on flag (`PotyroKeepAwake`, packages/native); on iOS the
web's lock (iOS 18.4 and later). A browser without either: the screen dims as before, and nothing
throws.

### Timers (`ctx.ui.timer`)

A countdown the **shell** keeps for the app, so it survives what the app does not: a page change, the
person leaving the app, a reload, a locked screen.

```ts
const rest = await ctx.ui.timer({ label: { en: "Rest", pl: "Odpoczynek" }, seconds: 90, id: "rest" });
rest.endsAt;            // when it rings (null while paused); `left` is the seconds left when read
await rest.pause();     // resume(), cancel() — the person can do the same on its chip
const running = await ctx.ui.timers();   // this app's, counting or paused, soonest first
```

- **A chip** on the tab bar (bottom right on a wide screen) shows each running timer on every page of the app and on the home
  screen — another app's names its app and opens it. Pause, resume and stop are on the chip. At the
  end it chimes and buzzes, and the chip turns "Time's up" until the person says Done. The chips are shell chrome: `--k-chrome-bottom` takes them in, so the add button and an app's own bottom bar sit above them.
- **At the end, with the screen locked:** a notification is scheduled for its end on the device —
  exactly the scheduling reminders use, so it rings with Potyro closed on Android and iOS. On the web
  a closed tab cannot ring: Potyro rings on time while it is open (a system notification too if the
  person allowed them and the tab is behind another), else the moment it is in front again. That is
  why a cook mode pairs a timer with `keepAwake`.
- **`id`** names a timer: starting one with the id of one that is running restarts it ("rest" restarts
  the rest timer rather than stacking a second). Without one, every call is new.
- **Limits:** 1 second to a day; a label is required; at most 10 at once per app (the 11th throws).
  The label is `Words`, shown in the app's language; a rung timer is no longer in `timers()`.
- **Drawing the countdown on the page** (a rest bar, a step's button): read `t.secondsLeft()` — whole
  seconds left now, rounded up exactly as the chip counts — and draw again when it changes, so the
  page and the chip never disagree by a second. While the page shows that countdown itself, say so
  with **`ctx.ui.drawsTimer(id)`** and the shell leaves out that timer's chip there, instead of the
  same countdown twice a line apart. Release it when the page stops showing it (a React effect's
  cleanup); the page going away, its sealed frame stopping or the app being left lets go too. Say it
  before starting the timer and the chip never flashes up. The timer still counts and rings either
  way; its chip shows on the app's other pages, and when it has rung (its Done is on the chip).

```tsx
// The rest bar draws the rest, so its chip stays out of the way while the workout screen is up.
useEffect(() => {
  if (!underWay) return;
  const drawn = ctx.ui.drawsTimer("rest");
  return () => drawn.release();
}, [underWay]);
const left = rest?.secondsLeft(now);   // the chip's own second
```

No permission — the person sees every timer on its chip and can stop it — and the same sealed (the
shell owns the countdown; the app only asks; `drawsTimer` crosses the realm's port as a number per
hold). All are new optional members: no app's `schemaVersion` changes.

### Guests — people who have not joined yet (`ctx.people`, `ctx.guests`)

A shared app is often set up before the others are in it: a trip's costs, a flat's chores. A **guest**
is a name — "Ana", "Tom" — that a `member` field can hold until that person joins:

```ts
const tom = await ctx.guests.add("Tom");               // { id: "guest_…", name: "Tom", guest: true }
await ctx.create("expense", { what: "Dinner", amount: 4200, paidBy: tom.id });
const everyone = ctx.people;                           // members and open guests — what a split divides by
```

- **Claiming.** When someone joins the shared app, Potyro asks them once whether they are one of the
  guests (and People keeps "That's me" for later). From then on every record naming the guest names
  *them* — `e.paidBy` resolves to their account, `{ id, name }` like any member, and the guest leaves
  `ctx.people`. Nothing is rewritten: the stored value is still the guest's id, so a copy that was
  offline, an export and the history all agree, and `createdBy` (KA-18) is untouched — it still says
  who typed the record. One person claims at most one guest; the first claim of a guest wins.
- **Who may do what.** Everyone in the app sees the same guests. Anyone who can change the app adds
  one; renaming and removing a guest are for whoever added it, or the owner; the owner (or the guest's
  creator) can also say a guest is the same person as a member or another guest ("Same person as…",
  for a duplicate or someone who joined without claiming). App code gets the same rules through
  `ctx.guests` and an error in words otherwise; claiming and "same person" are the person's, in the
  People panel, never app calls. The rules are applied when the guests are read, on every device, so
  a copy that wrote past them changes nothing.
- **Values.** A `member` value may be set to a guest that is not removed, and a stored one may name
  any guest there has ever been — a removed guest still reads with its name. A solo app has guests too:
  they are set up on this device and go with the app when it is shared.
- **Reading people:** use `ctx.people` for "everyone in the group". `ctx.space?.members ?? [ctx.me]`
  still works, and leaves the guests out.

New optional members; no record changes and no app's `schemaVersion` moves. Seeded sample data can
name guests the same way (the shell's seeders write them through `writePeople`), so a demo group can
be lively before anyone joins.
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

**Custom views of a shared app run sealed too** (#267, since 2026-10-16). The view is drawn in a
sandboxed frame of its own — an opaque origin with the realm's CSP, never the shell's page — from the
same source, and `props.runtime.ctx` there is the same mediated `ctx` the app's logic gets: every
member that reaches the store, a capability, the person or the shell is a message the host answers
through the one op table, so the view has exactly the logic's authority and nothing more. What a view
notices: `ctx.media.url` and `ctx.files.url` hand back URLs the frame made itself (the shell's own do
not load in another origin); `props.runtime.definition` is data, its functions left out; and
`ctx.caps.camera.live` is **not** there — the live camera stays with apps that run as yours for now
(docs/25). A view that stops answering for 2 s, or blocks the page for 2 s, is taken down and the
app's plain pages are shown instead (docs/22 §11). A trusted app's views run direct, as before.

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
| `--k-chrome-bottom` | The room the shell's chrome takes at the bottom: its tab bar (and the phone's gesture bar), and the chips of `ctx.ui.timer` while a countdown runs — on a phone they sit on the tab bar, on a wide screen at its bottom right. A view with its own bottom bar or floating button sits above it: `bottom: var(--k-chrome-bottom, 0px)`, so a rest running never covers Finish. Like `--k-chrome-top`, it changes while the view is open. |
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
2. **A `custom` view** when no built-in fits — the person's own app runs trusted, and a shared one
   draws it in its sealed frame (#267).
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
