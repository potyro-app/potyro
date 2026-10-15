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
in a colour derived from the app when `icon` or `accent` is absent.

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

  // ---- runtime inputs (view filter params, custom-view args) — PER PAGE ----
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
                      live?(opts?: { facing?: "user"|"environment"; width?: number; height?: number }): Promise<LiveCamera>; };  // trusted only, below
    notifications?: { schedule(n: { id: string; at: Date; title: string; body?: string }): Promise<void>;
                      cancel(id: string): Promise<void>; supportsExactScheduling: boolean; };
    geo?:           { current(): Promise<{ lat: number; lng: number }>; };
    haptics?:       { vibrate(pattern?: number | number[]): Promise<void>; };  // non-sensitive
    filesystem?:    { pick(): Promise<Blob>; save(name: string, data: Blob): Promise<void>; };
    network?:       { fetch(input: string, init?: RequestInit): Promise<Response>; };  // gated
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
        progress(label: Words): { update(fraction: number, detail?: string): void; done(): void }; };
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

- **Items.** A `destructive` item is always shown last, after a separator, in the danger colour —
  whatever order the app listed it in. Arrow keys, Home/End and Escape work; dismissing answers `null`.
- **Forms.** `fields` are ordinary field definitions, validated like an entity's before the form
  opens (a bad one throws in the action). They render with the record form's controls — number
  steppers with units, enum buttons, date chips, relation pickers — and required fields are checked
  the same way. The answer is the raw values: a relation's id, a number as a number.
- **Progress.** `update(fraction, detail?)` moves the bar (`detail` replaces the percentage, e.g. "24 of
  40"); `done()` removes it. It is announced as a progress bar.
- **Untrusted apps.** A question does not hold the sealed box: while a form is open the page keeps
  rendering, and the call's time budget pauses until it is answered.

These are new optional members: no existing app changes, so `schemaVersion` (the app's own data
version) is not bumped.

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
  onFrame(cb: (video: HTMLVideoElement, info: { time: number; width: number; height: number }) => void): () => void;
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

**Trusted apps only, for now.** In a shared app `live` is `undefined` (its logic runs in the browser
realm, which has no surface to draw on and no streaming op; docs/25 has the reasons and the path).
`permissions: { camera: true }` covers both `capture()` and `live()`.

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
   checked by a test), so "this option does not exist" is something to read, not assume.
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
