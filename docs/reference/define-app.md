---
title: defineApp
description: Every top-level option of defineApp, with its type, default and meaning.
section: reference
order: 1
---

# defineApp

`defineApp` takes the whole app as one object and returns it typed, checked and recognisable to
Potyro.

```ts
import { defineApp } from "potyro";

export default defineApp({
  id: "plants",
  name: "Plants",
  icon: "leaf",
  version: "1.0.0",
  schemaVersion: 1,
  language: "en",
  theme: { accent: "#3A7D44" },
  permissions: { camera: true, notifications: true },
  entities: { /* … */ },
  pages: [ /* … */ ],
});
```

The structure (entities, fields, pages) is validated when the app loads. Functions are typed by
TypeScript and never validated. An unknown key on a view is an error, not something ignored.

## Top level

| Option | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | required | The app's identifier. Keep it stable across versions. |
| `name` | `Words` | required | The name on the launcher and the browser tab. |
| `icon` | `string` | a monogram of the name | A Lucide icon name (`"shopping-cart"`), a shipped file (`"icon.svg"`), an inline `<svg>` or a `data:` image. |
| `version` | `string` | required | The code version. Bump it on every release. |
| `schemaVersion` | `number` | required | The data version. Bump it only when records change shape. |
| `language` | `Language` | – | The language the app's words are written in, a BCP 47 tag (`"en"`, `"pt-BR"`). |
| `languages` | `Language[]` | – | Every language the app carries, its own first. Added by translation. |
| `theme` | `Theme` | – | Accent colour, page ground and appearance. |
| `permissions` | `PermissionManifest` | none | The device powers the app expects. |
| `category` | `string` | – | The launcher group, one lowercase word (`"games"`). |
| `nav` | `"grid" \| "tabs"` | grid with several entities, tabs with few | How the app presents its pages. |
| `scope` | `ScopeDef` | – | The one record everything else belongs to. |
| `quickActions` | `QuickAction[]` | one "Add" per entity | Prominent create buttons. `[]` means nothing is added by hand. |
| `tile` | `(ctx: Ctx) => TileContent \| Promise<TileContent>` | the plain face | What the live launcher tile shows. |
| `demo` | `(ctx: Ctx) => void \| Promise<void>` | – | What a demo link plays once its sample records are in. |
| `entities` | `Record<string, EntityDef>` | required | What the app keeps. |
| `pages` | `PageInput[]` | required | What the app shows. See [Pages and view options](pages-and-views.md). |
| `reminders` | `Reminder[]` | – | Notifications derived from records. |
| `migrations` | `Migration[]` | – | How records move between schema versions. |
| `sources` | `Record<string, SourceDef>` | – | Outside data the app's Ask can read. |

### Words

Wherever a type says `Words`, you may write a plain string, `{ text, context }` to tell two meanings
of one text apart, or a map per language such as `{ en: "Water", pl: "Podlej" }`. Record values are
never translated. See [Translating your app](../guides/translating-your-app.md).

### Binding

```ts
type Binding = string | ((record: Resolved, ctx: Ctx) => Value);
```

A binding is a field key, or a function that computes the value from the record.

## Theme

```ts
theme: { accent: "#B4532A", background: "grain", appearance: "system" }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `accent` | `string` | derived from the app | The app's colour: its tile, buttons and highlights. |
| `background` | `Backdrop` | `"wash"` | Every page's ground. A page's own `background` wins. |
| `appearance` | `"light" \| "dark" \| "system"` | `"system"` | The app's own theme while it is open. The person's choice per app wins. |

`Backdrop` is `"wash"` (a glow of the accent), `"dots"`, `"grain"`, `"plain"` or `{ image }`. The
`image` is a path in the app's files, shown behind the page header and as the cover of a record with
no photo.

## Permissions

```ts
permissions: { camera: true, geo: true, network: { hosts: ["api.example.com"], rooms: true } }
```

Your own app gets every capability without asking. A shared app gets a capability only when it is
declared here and the person agrees. See [Your apps and other people's
apps](../concepts/trusted-and-sealed.md). Each key is a boolean unless noted.

| Key | Grants |
|---|---|
| `sync` | Declares that the app writes data that leaves the device. Changes what the sync question says, not whether it is asked. |
| `camera` | `ctx.caps.camera` |
| `filesystem` | `ctx.caps.filesystem` |
| `notifications` | `ctx.caps.notifications` |
| `geo` | `ctx.caps.geo` |
| `haptics` | `ctx.caps.haptics` |
| `network` | `ctx.caps.network`. `true`, or `{ hosts?: string[]; rooms?: boolean }`. `hosts` allow-lists `fetch` and `socket`, with `":port"` when it is not the usual one. `rooms` adds the rooms relay. `{ rooms: true }` alone allows nothing else. |
| `ai` | `ctx.caps.ai` |
| `speech` | `ctx.caps.speech` |

## Scope

```ts
scope: { entity: "trip", label: "Trip", required: true }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `entity` | `string` | required | The entity whose records can be selected. |
| `label` | `Words` | the entity's label | The header chip's label. |
| `required` | `boolean` | `false` | Ask for a selection before showing any page. |

The selection is per device and survives reloads. Every function reads it as `ctx.scope.<entity>`:
a resolved record, or `undefined` while none is chosen. Nothing is filtered for you. A page narrows
itself with `filter: (e, ctx) => e.trip?.id === ctx.scope.trip?.id`. A relation field pointing at
the scope entity defaults to the current selection on create.

## Quick actions

```ts
quickActions: [
  { id: "start", label: "Start a session", icon: "play", entity: "session", mode: "instant", openPage: "live" },
]
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | required | Named by a page's `primaryAction`. |
| `label` | `Words` | required | The button text. |
| `icon` | `string` | – | A Lucide name. |
| `entity` | `string` | required | What it creates. |
| `mode` | `"auto" \| "form" \| "menu" \| "instant"` | `"auto"` | `form` opens the create form. `menu` picks one required enum inline. `instant` creates from defaults and `prefill` with no form. `auto` is `menu` when the entity has exactly one required enum and no other required field, else `form`. |
| `open` | `boolean` | `true` | Open the new record after creating it. |
| `openPage` | `string` | the entity's detail page, then its list | Where to land after creating. |
| `prefill` | `Record<string, unknown>` | – | Values the new record starts with. |

## Tile

```ts
tile: async (ctx) => {
  const due = (await ctx.query("plant")).filter((p) => p.due);
  return { count: due.length, title: `${due.length} to water`, lines: due.slice(0, 3).map((p) => p.name) };
},
```

The function reads data through `ctx` and returns plain data. It must not write. A tile that
throws, writes or returns nothing shows the app's plain face, silently.

| Field | Type | Meaning |
|---|---|---|
| `count` | `number` | What is waiting. A small tile shows only this. |
| `title` | `Words` | The headline of the live face. |
| `lines` | `Words[]` | Up to three short lines under it. |
| `image` | `MediaRef \| FileRef \| string` | A media field's value, a file field's value, or a path in `ctx.files`. |

## Demo

```ts
demo: async (ctx) => { await replayFeed(ctx); },
```

Every shared link opens the app as a demo on its sample records. An app that lives on a feed
declares what to play instead. Potyro calls `demo(ctx)` once the sample records are in and does not
wait for it. It runs only for a demo link, never for a copy someone keeps. See
[Sharing](../concepts/sharing.md).

## Entities

```ts
entities: {
  plant: {
    label: "Plant",
    icon: "leaf",
    displayField: "name",
    fields: {
      name: { type: "text", required: true },
      photo: { type: "media" },
      lastWatered: { type: "datetime" },
      waterEvery: { type: "duration", unit: "d" },
    },
    groups: [{ title: "Care", fields: ["lastWatered", "waterEvery"], collapsible: true }],
    computed: { due: { label: "Due", value: (p, ctx) => nextWatering(p) <= ctx.now() } },
    actions: {
      water: { label: "Water", icon: "droplets", run: async (p, ctx) => { await ctx.patch("plant", p.id, { lastWatered: ctx.now() }); } },
    },
  },
},
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `label` | `Words` | the key, humanised | What one record is called. |
| `icon` | `string` | – | A Lucide name. |
| `displayField` | `string` | – | The field that names a record in rows, pickers and quick add. |
| `fields` | `Record<string, Field>` | required | See [Field types](field-types.md). |
| `groups` | `FieldGroup[]` | declaration order | How the form and the record page arrange the fields. |
| `computed` | `Record<string, Computed \| ComputedDef>` | – | Values worked out from the record. |
| `actions` | `Record<string, ActionFn \| ActionDef>` | – | What a person can do to a record. |
| `editableBy` | `"anyone" \| "creator" \| "app"` | `"anyone"` | Who may change or delete a record. `creator`: only who added it. `app`: only app code. |
| `share` | `"record"` | – | Each record can be shared by its own link. See [Sharing](../concepts/sharing.md). |
| `hidden` | `boolean` | `false` | The app's own bookkeeping. Never shown to people, nor in Changes. |

### FieldGroup

| Option | Type | Default | Meaning |
|---|---|---|---|
| `title` | `Words` | – | The heading. |
| `fields` | `string[]` | required | Field keys, or computed keys (record page only). |
| `collapsed` | `boolean` | `false` | Start folded. The first group never folds. |
| `collapsible` | `boolean` | `false` | The heading folds it on the record page, remembered per device. |

Fields left out of every group follow the last group, untitled, in declaration order.

### Computed

```ts
type Computed = (record: Resolved, ctx: Ctx) => Value | Promise<Value>;
```

A bare function, or a `ComputedDef`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `value` | `Computed` | required | The function. |
| `label` | `Words` | the key, humanised | Its heading where a page shows it. |
| `labels` | `Record<string, Words>` | – | Words per returned key, as an enum's `labels`. |
| `format` | `Words` | – | How an object value reads: an ICU message over its properties. |

A computed value is a property of the record wherever a function receives one: `plant.due`.

### Actions

```ts
type ActionFn = (record: Resolved, ctx: Ctx, input?: unknown) => void | Promise<void>;
```

A bare function, or an `ActionDef`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `run` | `ActionFn` | required | The function. |
| `label` | `Words` | the key, humanised | The button text. |
| `icon` | `string` | – | A Lucide name, before the label. |
| `description` | `string` | – | What it does, for Ask. |
| `input` | `Record<string, Field>` | – | A form the button opens. Its values reach `run` as the third argument, checked. |

Pages name actions by key: a list's `rowActions`, a detail view's `actions`. See [Computed, actions
and reminders](../guides/computed-actions-reminders.md).

## Reminders

```ts
reminders: [{
  id: "water-due",
  entity: "plant",
  when: (p) => (p.active ? nextWatering(p) : null),
  title: (p) => `Water ${p.name}`,
  body: "Tap to log it",
}],
```

| Option | Type | Meaning |
|---|---|---|
| `id` | `string` | A stable identifier. |
| `entity` | `string` | The records it watches. |
| `when` | `(record: Resolved, ctx: Ctx) => Date \| null` | When to notify. `null` means no reminder for this record. |
| `title` | `Binding` | The notification's title. |
| `body` | `Binding` | An optional second line. |

Potyro recomputes reminders after every write and schedules them through
`ctx.caps.notifications`.

## Migrations

```ts
migrations: [{
  from: "1", to: "2",
  steps: [
    { op: "renameField", entity: "plant", from: "water", to: "waterEvery" },
    { op: "addField", entity: "plant", field: "active", default: true },
    { transform: (record, ctx) => ({ ...record, name: String(record.name).trim() }) },
  ],
}],
```

`from` and `to` are schema versions, as strings. Each step is one of:

| Step | Fields |
|---|---|
| `addField` | `entity`, `field`, `default?` |
| `dropField` | `entity`, `field` |
| `renameField` | `entity`, `from`, `to` |
| `changeType` | `entity`, `field`, `to`, `via: (value) => value` |
| `renameEntity` | `from`, `to` |
| `setDefaultForExisting` | `entity`, `field`, `value` |
| `addRelation` | `entity`, `field`, `to`, `many?` |
| `addRecord` | `entity`, `id`, `values`: a record old ones can point at |
| `{ transform }` | `(record: PotyroRecord, ctx: Ctx) => PotyroRecord`: any change, in code |

See [Changing an app that has data](../guides/changing-an-app-with-data.md).

## Sources

```ts
sources: {
  places: {
    label: "Places",
    description: "Finds places near a point",
    endpoint: "https://api.example.com/v1/",
    auth: { header: "X-Api-Key" },
  },
},
```

| Option | Type | Meaning |
|---|---|---|
| `label` | `string` | Its name. |
| `description` | `string` | What it answers, for Ask. |
| `endpoint` | `string` | The base URL, https. Requests stay under it. |
| `docs` | `string` | Documentation Ask may read. |
| `auth` | `{ header: string; prefix?: string } \| { query: string }` | How the person's key is sent. None: no key. |

Never put a key here. Each person adds their own, and it never reaches app code. Sources are for
Ask and are not reachable from `ctx`. See [The Studio](../concepts/the-studio.md).

## Next

- [Field types](field-types.md): every field and its options.
- [Pages and view options](pages-and-views.md): the page object and every view.
- [ctx](ctx.md): everything a function can do.
