---
title: ctx
description: Every member of ctx, the one object through which an app reaches its data, the person, the screen and the device.
section: reference
order: 4
---

# ctx

`ctx` is the host API: every function in an app receives it, and nothing reaches the device any
other way.

```ts
actions: {
  water: async (plant, ctx) => {
    await ctx.patch("plant", plant.id, { lastWatered: ctx.now() });
    const left = (await ctx.query("plant", { filter: (p) => p.due })).length;
    ctx.ui.toast(left ? `${left} still to water` : "All watered");
  },
},
```

Everything that touches storage or the device is async. `now()`, `params`, `scope`, `me`,
`people` and `locale` are fixed for one evaluation pass, so a computed value is stable within a
render.

## Data

Every read returns a `Resolved` record: its fields, relations one level deep, and computed values as
properties.

```ts
query(entity: string, spec?: QuerySpec): Promise<Resolved[]>
get(entity: string, id: Id): Promise<Resolved | null>
create(entity: string, data: Record<string, unknown>): Promise<Resolved>
patch(entity: string, id: Id, data: Record<string, unknown>): Promise<Resolved>
increment(entity: string, id: Id, field: string, delta: number): Promise<Resolved>
delete(entity: string, id: Id): Promise<void>
transaction<T>(fn: (tx: Ctx) => Promise<T>): Promise<T>
access(entity: string, id: Id): Promise<"reader" | "writer" | "admin">
text(entity: string, id: Id, field: string): CtxText
```

| Member | Meaning |
|---|---|
| `query` | Records matching `spec`: `{ filter?, sort?, limit?, offset? }`. `filter` and `sort` are plain functions run over resolved rows. |
| `get` | One record, or `null`. |
| `create` | A new record. Values are checked against their fields. |
| `patch` | Change some fields. Fields left out stay as they are. |
| `increment` | Add `delta` to a number field. Two people's increments are summed; two patches of `n + 1` lose one. |
| `delete` | Remove a record. |
| `transaction` | Run several writes as one, through `tx`. |
| `access` | What this device may do with a record: look, change it, or also invite others to it. For a record of an entity declared `share: "record"`, the record's own answer; otherwise the app's. |
| `text` | A handle on a collaborative text field. See below. |

`createdBy` and `updatedBy` are stamped by Potyro and cannot be set or patched. A value that does
not fit its field is rejected with a message for the person.

### Collaborative text

`ctx.text(entity, id, field)` returns a `CtxText` for a `text` field declared `collaborative: true`.

```ts
edit(edits: TextEdit[], opts?: { base?: string }): Promise<Resolved>
runs(): Promise<TextRun[]>
anchor(at: number): Promise<string>
index(anchor: string): Promise<number | null>
```

| Member | Meaning |
|---|---|
| `edit` | Apply changes in order. A `TextEdit` is `{ at, insert }` or `{ from, to }`. Positions count UTF-16 units of `base`, the text as you last showed it; Potyro moves them onto the text as it is now. |
| `runs` | The whole text as stretches, each with `by`, the account id of who typed it, or `null`. |
| `anchor` | An opaque marker that follows the character at `at` through everyone's edits. Keep it in a text field. |
| `index` | Where an anchor's character is now, or `null` once deleted. |

See [Working together](../guides/working-together.md).

## Time

```ts
now(): Date
today(): Date
```

Both are fixed per evaluation pass. Use `ctx.now()` rather than `new Date()` in computed values,
filters and sorts, so every row agrees on the time.

## Inputs

```ts
params: Readonly<Record<string, unknown>>
scope: Readonly<Record<string, Resolved | undefined>>
```

| Member | Meaning |
|---|---|
| `params` | The current page's inputs: the values of its filter chips, and the params it was navigated to with. Per page: a chip on one page is not visible to another. |
| `scope` | The app-wide selected record, when the app declares a `scope`: `ctx.scope.trip` is a resolved record or `undefined`. `{}` without a scope. Per device, live, synchronous. |

## Words and formats

```ts
locale: Language
t(words: Words, vars?: Record<string, string | number | Date>): string
format: CtxFormat
```

| Member | Meaning |
|---|---|
| `locale` | The language the app's words are shown in, one of its `languages`. |
| `t` | `Words` as a string in `locale`. With `vars`, an ICU message: `ctx.t("{n, plural, one {# plant} other {# plants}}", { n })`. |
| `format.locale` | The tag formats use, such as `"pl-PL"`. |
| `format.date(d, opts?)` | A date. `opts`: `dateStyle`, `timeStyle`, `weekday`, `day`, `month`, `year`, `hour`, `minute`. |
| `format.number(n, opts?)` | A number. `opts`: `style` (`"decimal"`, `"percent"`, `"unit"`), `unit`, `minimumFractionDigits`, `maximumFractionDigits`, `signDisplay`. |
| `format.money(minor, currency?)` | Whole minor units: `money(4200, "EUR")` is "42,00 €". |
| `format.relative(d, opts?)` | From `ctx.now()`: "in 3 days". `opts`: `unit`, `numeric`. |
| `format.list(items, opts?)` | "a, b and c". `opts.type`: `"conjunction"` or `"disjunction"`. |

Use `format` only for text the app composes. Return a `Date` or a number where a view formats it.

## Storage

```ts
storage.get<T = unknown>(key: string): Promise<T | null>
storage.set(key: string, value: unknown): Promise<void>
storage.delete(key: string): Promise<void>
storage.keys(prefix?: string): Promise<string[]>
```

App-scoped key/value storage, separate from records. For settings and remembered state.

## Files

The app's own folder. Name a file by path (`"notes/a.md"`) or by a `file` field's value. Reading a
missing path throws. `null` means the bytes have not reached this device yet.

```ts
files.list(folder?: string): Promise<FileInfo[]>
files.stat(file: string | FileRef): Promise<FileInfo | null>
files.text(file: string | FileRef): Promise<string | null>
files.json<T = unknown>(file: string | FileRef): Promise<T | null>
files.bytes(file: string | FileRef): Promise<Uint8Array | null>
files.url(file: string | FileRef): Promise<string | null>
files.write(path: string, data: string | Uint8Array | Blob, opts?: { mime?: string }): Promise<FileInfo>
files.rename(file: string | FileRef, to: string): Promise<FileInfo>
files.remove(file: string | FileRef): Promise<void>
files.import(opts?: { folder?: string; accept?: string; multiple?: boolean }): Promise<FileInfo[]>
files.export(file: string | FileRef): Promise<void>
```

| Member | Meaning |
|---|---|
| `list` | All files, or those under `folder`. |
| `stat` | A file's `FileInfo`: `id`, `path`, `name`, `mime`, `size`, `hash`, `origin`, `created`, `updated`. |
| `text`, `json`, `bytes` | The contents. |
| `url` | For `<img>`, `<audio>`, `<video>` or a link. |
| `write` | Create or replace. The `id` is kept. |
| `rename`, `remove` | Move or delete. |
| `import` | The person picks files, which land under `folder`. `[]` when they cancel. |
| `export` | Save a copy outside the app. |

`origin` is `"shipped"` (came with the app), `"app"` (written by its code) or `"imported"`. Files
need no permission: the folder belongs to the app, and `import` and `export` go through the system's
own dialog.

### Media

```ts
media.put(bytes: Blob): Promise<MediaRef>
media.url(ref: MediaRef): Promise<string>
```

Store a blob as a `media` field's value, and get a URL for one.

## People

```ts
me: Person
space?: Space
people: readonly Person[]
guests: CtxGuests
```

A `Person` is `{ id: Id; name: string; guest?: true }`.

| Member | Meaning |
|---|---|
| `me` | You. Always present, in a solo app too. |
| `space` | The space the data lives in, or `undefined` for a solo app. `{ id, members, role, invite() }`. Each member has a `role`: `"admin"`, `"writer"` or `"reader"`. `invite()` mints an invite link through the shell. |
| `people` | Everyone a `member` field can name now: the space's members (just you, solo) and unclaimed guests. Use this for "everyone in the group". |
| `guests.add(name)` | A placeholder person who has not joined. Returns a `Person`; store its `id` in a `member` field. |
| `guests.rename(id, name)` | Rename a guest. |
| `guests.remove(id)` | Take a guest off the list. Records naming it still read with its name. |

Read "everyone here" as `ctx.people`, not by branching on whether `space` exists.

## UI

Every text parameter takes `Words`.

```ts
ui.toast(msg: Words): void
ui.confirm(msg: Words, opts?: { detail?: Words; ok?: Words; cancel?: Words; destructive?: boolean }): Promise<boolean>
ui.prompt(msg: Words, opts?: { default?: string }): Promise<string | null>
ui.pick<T>(items: T[], opts?: { label?: (t: T) => string; multi?: boolean }): Promise<T | T[] | null>
ui.sheet<T = string>(opts: { title?: Words; items: UiItem<T>[] }): Promise<T | null>
ui.menu<T = string>(opts: { title?: Words; items: UiItem<T>[] }): Promise<T | null>
ui.form<T>(opts: { title: Words; fields: Record<string, Field>; initial?: Partial<T>; submit?: Words }): Promise<T | null>
ui.progress(label: Words): UiProgress
ui.share(opts: { text?: Words; url?: string; title?: Words; app?: ShareAppLink; record?: RecordLink; files?: ShareFile[] }): Promise<boolean>
ui.keepAwake(): UiKeepAwake
ui.timer(opts: { label: Words; seconds: number; id?: string }): Promise<UiTimer>
ui.timers(): Promise<UiTimer[]>
ui.drawsTimer(id: string): UiDrawnTimer
```

| Member | Meaning |
|---|---|
| `toast` | A short message. |
| `confirm` | A yes/no question. `ok` names the button, `destructive` makes it red, `cancel` names the other button. |
| `prompt` | One line of text, or `null` when cancelled. |
| `pick` | One item from a list, or several with `multi`. `null` when dismissed. |
| `sheet` | A short list of choices: a bottom sheet on a phone, a dialog on a wide screen. `null` when dismissed. |
| `menu` | The same, hanging under the button that ran the action on a wide screen. |
| `form` | Several values at once, with the record form's controls. Relations come back as ids. `null` when cancelled. |
| `progress` | A bar for a long action: `update(fraction, detail?)` and `done()`. |
| `share` | Hand words, a link or files on: the share sheet, Copy or Save a copy. `true` when handed on, `false` when closed. `app: { page, params? }` makes a link into this app. `record: { entity, id, role?, page?, param? }` makes a link to one record of an entity declared `share: "record"`. |
| `keepAwake` | Keep the screen on until `release()` or the person leaves the app. |
| `timer` | A countdown the shell keeps across pages and a locked screen. `seconds` is 1 to a day. Starting a timer with a running timer's `id` replaces it. |
| `timers` | This app's running or paused timers, soonest first. |
| `drawsTimer` | This page draws timer `id` itself, so the shell hides its chip until `release()`. |

A `UiItem` is `{ id, label, detail?, icon?, destructive? }`. A `UiTimer` has `id`, `label`,
`seconds`, `endsAt`, `left`, `paused`, `secondsLeft(at?)`, `cancel()`, `pause()` and `resume()`.
A `ShareFile` is a `Blob`, `Uint8Array`, `FileRef` or `MediaRef`. See [Asking the
person](../guides/asking-the-person.md).

## Views

```ts
views.map(pageId: string): MapViewControl
```

Reach a map that is on screen. Each method resolves to `false` when that page is not open.

| Method | Meaning |
|---|---|
| `flyTo({ center: [lng, lat], zoom? })` | Move the map. `zoom` is kept when omitted. |
| `fit()` | Frame every pin. |
| `select(id)` | Bring a record's pin, and its strip card, to the front. |
| `open(id)` | Open the record as a tap on its pin would. |

## Navigation

```ts
navigate(pageId: string, params?: Record<string, string>): void
```

Open a page. `params` become its `ctx.params`.

## Log

```ts
log(...args: unknown[]): void
```

Diagnostics, for you while developing. Never shown to the person.

## Capabilities

```ts
caps: {
  camera?: CameraCapability;
  notifications?: NotificationCapability;
  geo?: GeoCapability;
  haptics?: HapticsCapability;
  filesystem?: FileCapability;
  network?: NetworkCapability;
  ai?: AiCapability;
  speech?: SpeechCapability;
}
```

Every member is optional: check for it before use. In your own app all are present. In a shared app
a member is present only when declared in `permissions` and granted by the person.

| Family | Members | Details |
|---|---|---|
| `camera` | `capture(opts?: { source?: "camera" \| "library" }): Promise<Blob>`, `live?(opts?): Promise<LiveCamera>` | [ctx.caps.camera](ctx-caps-camera.md) |
| `notifications` | `schedule({ id, at, title, body? })`, `cancel(id)`, `supportsExactScheduling: boolean` | [Device capabilities](../guides/device-capabilities.md) |
| `geo` | `current(): Promise<{ lat, lng }>` | [Device capabilities](../guides/device-capabilities.md) |
| `haptics` | `vibrate(pattern?: number \| number[])` | [Device capabilities](../guides/device-capabilities.md) |
| `filesystem` | `pick(): Promise<Blob>`, `save(name, data: Blob)` | [Device capabilities](../guides/device-capabilities.md) |
| `network` | `fetch(input, init?)`, `socket(url, opts?)`, `room(id?, opts?)` | [ctx.caps.network](ctx-caps-network.md) |
| `ai` | `extract({ schema, instructions?, image?, text? })`, `ask(prompt, opts?)` | [ctx.caps.ai](ctx-caps-ai.md) |
| `speech` | `listen(opts?: { language?, interim? }): Promise<SpeechSession>` | [ctx.caps.speech](ctx-caps-speech.md) |

## ViewProps

What a custom view receives, as `render(props)` or `mount(el, props)`.

```ts
interface ViewProps<Opts = unknown> {
  runtime: Runtime;
  entity: string;
  options: Opts;
  param?: Record<string, string>;
  navigate: (pageId: string, param?: Record<string, string>) => void;
}
```

| Member | Meaning |
|---|---|
| `runtime` | Data subscriptions and the full `ctx`, below. |
| `entity` | The view's entity. |
| `options` | The view's declarative bindings, resolved. |
| `param` | The page's params, such as `{ id }`. |
| `navigate` | Open another page. |

`props.runtime`:

```ts
definition: Localized<AppDefinition>
language: { current: Language | undefined; default: Language | undefined; available: Language[] }
ctx: Ctx
watchQuery(entity, spec, cb: (state: { rows; loading; error? }) => void): Unsubscribe
watchRecord(entity, id, cb: (state: { record; loading; error? }) => void): Unsubscribe
useQuery(entity, spec?): { rows: Resolved[]; loading: boolean; error?: string }
useRecord(entity, id): { record: Resolved | null; loading: boolean; error?: string }
runAction(entity, key, id, input?): Promise<void>
create(entity, data): Promise<PotyroRecord>
patch(entity, id, data): Promise<void>
remove(entity, id): Promise<void>
```

`watchQuery` and `watchRecord` are subscriptions any framework can use. `useQuery` and `useRecord`
are React hooks over them. `definition` is the app with every `Words` already in the person's
language. The shell exposes two CSS custom properties for a view's own layout. `--k-chrome-bottom`
is the room its tab bar and timer chips take. `--k-chrome-top` is the room its top signs take. See
[Custom views](../guides/custom-views.md).

## How ctx differs by trust

App code sees the same interface in your own app and in a shared one. The authority behind it
differs. See [Your apps and other people's apps](../concepts/trusted-and-sealed.md).

| Member | Your own app | A shared app |
|---|---|---|
| Data, time, inputs, words, storage, files, media, ui, views, navigate, log | Direct. | Present, mediated through the sandbox. Values in, values out. |
| `me`, `people`, `guests` | Direct. | Present. |
| `space.invite()` | Works, for an admin. | Never reaches app code. |
| `caps.*` | All present, unmediated, no prompts. | Each member `undefined` unless declared in `permissions` and granted after a one-time question. Granted members may be scoped: `network` to its `hosts`, `filesystem` to an app-private area. |
| `caps.ai` | Present with `permissions.ai`. Can be turned off per app. | Asked once per app, naming the service and what goes. Only what a call names is sent. |
| `caps.camera.live` | Present. | Absent. |
| Custom views | Run in the page. | Run in a sandboxed frame of their own, with the same mediated `ctx`. `definition` carries data only, its functions left out. `media.url` and `files.url` return URLs the frame made itself. A view that stops answering is taken down and the app's plain pages are shown. |
| `t` and `format` | Direct. | The same results, inside the sandbox. |

## Next

- [Asking the person](../guides/asking-the-person.md): the `ui` members in practice.
- [Custom views](../guides/custom-views.md): building a screen on `ViewProps`.
- [Your apps and other people's apps](../concepts/trusted-and-sealed.md): what the sandbox is.
