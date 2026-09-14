# 03 · Definition Model (`*.app.ts`)

An app is a TypeScript module that default-exports `defineApp({...})`. The object mixes
**declarative structure** (data: entities, fields, view layout — gives storage/forms/
validation/migrations for free) with **code logic** (functions: computed, filters, actions,
reminders, custom views — full TypeScript, no restrictions).

`defineApp` is a typed builder (identity + normalize + dev-time Zod check of the declarative
parts). It does not restrict logic; functions are just typed by TS.

## Top-level shape

```ts
import { defineApp, f } from "karta";          // f = field builders (optional sugar)
import { scoreDifficulty } from "./lib/difficulty";   // your own imports — allowed

export default defineApp({
  id: "recipes",
  name: "Recipes",
  icon: "🍳",                       // the launcher tile; without it, a monogram in a derived colour
  version: "1.0.0",
  schemaVersion: 1,
  theme: { accent: "#E4A93C" },     // colours the app when open, and its tile

  // declares what native powers this app expects; used for the trust prompt when the app
  // is run untrusted. Trusted (own) apps get everything without prompting.
  permissions: { camera: true, filesystem: true /* network, notifications, geo … */ },

  // optional: the one record everything else belongs to (a trip, a project). The shell shows it in
  // the header with a picker; every function reads it synchronously as `ctx.scope.trip`. Pages
  // narrow themselves: `filter: (e, ctx) => e.trip?.id === ctx.scope.trip?.id`. Per device.
  scope: { entity: "trip", required: true },

  // Display options marked `Dynamic<T>` in docs/04's types accept a function of ctx in place of the
  // literal — a page `title`, a list's `emptyText`, an aggregate's `title`, a map's `camera`:
  //   title: (ctx) => `Places in ${ctx.scope.trip?.city ?? "…"}`
  // The host evaluates it on every pass (and in the isolate for a shared app). `sort` receives
  // `ctx` as its third argument for the same reason: `(a, b, ctx) => …`.

  entities: { /* … */ },   // declarative shape + co-located computed/action functions
  pages:    [ /* … */ ],   // declarative view layout; display/filter/sort may be functions
  reminders:[ /* … */ ],   // functions
  migrations: [ /* … */ ], // see docs/06 (functions allowed)
});
```

## Entities: declarative shape + co-located logic

```ts
entities: {
  recipe: {
    label: "Recipe",
    displayField: "name",
    fields: {
      name:       { type: "text", required: true },
      photo:      { type: "media", accept: "image" },
      servings:   { type: "number", default: 2, min: 1, integer: true },
      ingredients:{ type: "list", of: {
        ingredient: { type: "relation", to: "ingredient", required: true },
        quantity:   { type: "number", min: 0, required: true },
        unit:       { type: "enum", options: ["g","ml","tbsp","tsp","cup","piece"] },
      }},
      steps:      { type: "list", ordered: true, of: {
        text: { type: "text", multiline: true, required: true },
        durationSec: { type: "number", min: 0 },
      }},
    },

    // ---- LOGIC: real functions. Relations on `r` are pre-resolved by the runtime. ----
    computed: {
      calories: (r) => r.ingredients.reduce(
        (s, i) => s + i.ingredient.caloriesPer100 * i.quantity / 100, 0),
      protein:  (r) => r.ingredients.reduce(
        (s, i) => s + i.ingredient.proteinPer100 * i.quantity / 100, 0),
      caloriesPerServing: (r, ctx) => r.calories / Math.max(r.servings, 1),
      difficulty: (r) => scoreDifficulty(r),          // imported helper — full code
    },

    actions: {
      markCooked: async (r, ctx) => {
        await ctx.patch("recipe", r.id, {
          lastCookedAt: ctx.now(),
          timesCooked: (r.timesCooked ?? 0) + 1,
        });
      },
    },
  },
}
```

- **Fields** are declarative — the runtime uses them for persistence, form generation,
  validation, view binding, migrations. Same closed type set as before (see "Field types").
  Every field may carry presentation hints: `label`, `required`, `hidden`, `help` (one line
  under the control), `placeholder` (example text in an empty control) and `width: "half"`
  (two half-width neighbours share a row on a wide form; they stack on a phone).
- **`groups`** arrange the fields: `groups: [{ title?, fields: [...], collapsed? }]`. The form
  and the detail page read the same declaration, so what is edited under "Nutrition" is read
  back under "Nutrition". A group may list computed keys — they show on the detail page, and
  the form skips them. Fields left out of every group follow the last one, untitled. A
  `collapsed` group starts folded (never the first). A detail page's `sections` override the
  groups for that page only. A group naming a field the entity does not have, or listing one
  twice, fails validation by name.
- **`computed`** are functions `(record, ctx) => value | Promise<value>`. Relations are
  resolved one level deep on `record`; deeper or cross-entity work uses `ctx.query`. Memoized
  per query pass. Referenced in views exactly like fields.
- **`actions`** are functions `(record, ctx, input?) => void | Promise<void>`. They do whatever
  you want through `ctx` (patch, create, call caps, prompt the user…).

## Field types (declarative, closed set)

`text · richtext · number · boolean · enum · tags · datetime · duration · url · geo · media ·
relation · list`. (No `computed` field *type* — computed is a function block. This cleanly
separates shape from logic.) Options per type are unchanged from the prior schema draft
(min/max/unit, enum options, relation `to`/`many`, list `of`/`ordered`, media `accept`/
`multiple`, etc.). `default` may be a value or a function `(ctx) => value`.

A `list` field's rows are cards (#104): the first sub-field is the line you read, the rest sit under
it, and Remove lives in the card's own menu. `ordered: true` earns a grip — drag it with a pointer or
a finger, or focus it and press an arrow — and the record page then reads the list as a numbered
list rather than a table. On a phone a card can be swiped aside to reveal Remove. The button that
adds one names what it adds, from the field's label.
A `media` field is a tile, never the browser's file button (#102). Empty it says what it wants
("Add photo", or video/audio per `accept`); on a phone it offers Camera or Library through
`ctx.caps.camera`, and on a wide screen it opens the file dialog and takes a dropped file. Filled it
shows the thing, with a way to take it off. `multiple: true` makes it a strip with the add tile
last. The same tile renders the value on a record page, so one photo looks like one photo
everywhere. A file that fails to store says so, with a way to try again.

A `list`, `gallery` or `table` view can put its rows under headings with `group` (#108): a field key
— an enum, a tag (a row sits under each of its tags), a relation, shown by the record's name — or a
function such as `(r) => monthOf(r.date)`. The view's `sort` holds inside each group; groups follow
the enum's option order, else the order they first appear, and rows with no value come first under
no heading. `collapsible: true` makes each heading a button that folds its group, with a count,
remembered on the device per page; on a phone the heading sticks under the top bar while its rows
scroll past. On a record page, a detail section or an entity group with `collapsible: true` folds
the same way (`collapsed: true` starts it folded), and a section that is one list shows its count.
A `relation` is a searchable picker too. One record opens the same list a long enum uses and closes
on a pick; `many: true` shows the chosen records as chips you can take off, with Add opening the
list with checkmarks. When the search finds nothing, the list's last line creates the record, named
with what was typed, in a sheet over the form, and selects it. No form renders a `<select>`.

A `board` page puts records in columns by an enum field (#107): `{ type: "board", entity, column }`,
with `columns` to choose and order a subset of the options, the same `display` a list has, `filter`,
`sort` (the order inside every column) and `onOpen`. Dragging a card to another column patches that
field, and so does "Move to…" in the card's menu — the way a keyboard or a phone moves a card. An
empty column offers Add, pre-filled with its value; records whose value is not a column sit in a
leading "No …" column. `allowMove: false` makes it read-only. Cards do not reorder inside a column.

Numbers folded out of a page's rows are a `stats` view and a `chart` view (#109), usually stacked in
one page `layout`. A stats tile is a summary figure — `{ label, op, field }` or
`{ label, value: (rows, ctx) => … }` — with an optional `unit` and
`compare: { value, label, as? }`, which reads "▲ 1 more than last week" or, with `as: "percent"`,
"▼ 6% less than last week": an arrow and words, never colour alone. A chart is
`{ type: "chart", entity, series: (rows, ctx) => [{ label, value, text? }], title?, subtitle?,
emptyText? }`: bars on a recessive grid, the latest labelled, the rest answering on hover, tap or the
arrow keys, with the same numbers in a visually hidden table. Every function runs through the host,
so both render untrusted.

An `enum` never renders a browser `<select>` (#98). Up to five options are a row of buttons, all
visible at once; six or more open a searchable picker — a bottom sheet on a phone, a popover on a
wide screen. A field may force either with `control: "segmented" | "picker"`. Each value carries a
tint, the same in the form, in a row badge and on the record page: derived from the value's own
name, or named by the field with `colors: { overdue: "red" }` from the closed set red · orange ·
yellow · green · teal · blue · purple · pink · grey. A required enum with no `default` starts on
nothing. `tags` with no `options` is free-text: type a word, press Enter, it becomes a chip.

A `datetime` is a **day** unless the field says `precision: "minute"` (#103). Most dates are
days — when a plant was watered, when a bill is due — and the form offers a day: the box reads
"Today, 12 Sep", chips set today, yesterday or tomorrow in one tap, the calendar button opens a
month grid (a sheet on a phone, a popover on a wide screen), and typing `12/9/2026`, `12 sep` or
`tomorrow` works too. A day is stored at local midnight and never shows a time. A minute field
adds an hour box beside the day and shows its time wherever the value appears.

## Pages & views: declarative layout, code where it's logic

A page has `id`, `title` (a string or a function of `ctx`), an optional `icon` — one emoji for its
tab; without it the tab shows the entity's icon — `hidden` for a page reached by tapping a row
rather than from the navigation, an optional `summary` strip, and its `view`. The shell decides
how pages are presented (#111): a bottom tab bar on a phone (four pages and More), a sidebar on a
wide screen; the app never lays out its own chrome.

```ts
pages: [
  {
    id: "all", title: "Recipes",
    view: {
      type: "list", entity: "recipe",
      sort: (a, b) => a.name.localeCompare(b.name),         // JS comparator
      display: {
        primary: (r) => r.name,                             // functions or field keys
        secondary: (r) => `${Math.round(r.caloriesPerServing)} kcal/serving`,
        media: "photo",
      },
      rowActions: ["markCooked"],
    },
  },
  {
    id: "cook-with", title: "What can I cook?",
    view: {
      type: "list", entity: "recipe",
      // arbitrary JS predicate — reads ctx.params, set by a picker in the view chrome
      filter: (r, ctx) => {
        const have = new Set((ctx.params.pantry as string[]) ?? []);
        return r.ingredients.every((i) => have.has(i.ingredient.id));
      },
      display: { primary: "name", media: "photo" },
    },
  },
  {
    id: "cook", title: "Cook", hidden: true,
    view: {
      type: "custom", entity: "recipe", param: "recipeId",
      render: (props) => <CookAlong {...props} />,          // a full React component
      onFinish: "markCooked",
    },
  },
]
```

### Page `layout` — several views on one page

```ts
{
  id: "today", title: "Today", icon: "☀️",
  layout: {
    type: "grid",                          // stack | grid | split | tabs
    items: [
      { title: "Watering", span: 1, view: { type: "aggregate", entity: "plant", rows: ... } },
      { title: "Overdue",  span: 2, view: { type: "list", entity: "plant", filter: (p) => p.overdue } },
      { title: "This month", span: 3, view: { type: "calendar", entity: "plant", date: "nextWatering" } },
    ],
  },
}
```

A page declares either `view` or `layout` (#105). `stack` is a column, and a `collapsible` item
folds behind its title, remembered per device. `grid` lays items out by `span` — three columns
from 900px of page, two from 560px, one below, measured on the page rather than the window, so a
grid beside a sidebar or inside the Studio's preview still fits. `split` is exactly two items: a
list on the left whose rows fill the `detail` on the right instead of navigating (the row's
`onOpen` params become the page's params, which the detail reads); on a phone the rows navigate as
usual. `tabs` shows one item at a time behind a segmented control made of the items' titles.

Every item is an ordinary view, addressed as `<pageId>#<index>` wherever a page id used to name
one view, so filters, sorts, bindings and queries work per item and a layout renders for an
untrusted app exactly as its views do. `ctx.params` are the page's, shared by every item. The
page's `summary` and filter chips read the first item. `defineApp` fills `view` from a layout's
first item, so anything that reads a page's view sees the primary one.

### Built-in view types (conveniences)

`list · table · detail · gallery · calendar · map · steps`. Their bindings (`date` for
calendar, `geo` for map, `list` for steps, `columns` for table, `sections` for detail) are as
before, except **any binding, filter, or sort may be a function** instead of a field key.

Views are validated **strictly**: an unknown key on a view is an error, not something quietly
ignored. A silently-accepted `zoomLevel: 12` is indistinguishable from a working feature until
someone notices the map never moves — and it is exactly what a generated view invents when it is
reaching for behaviour the view does not have. Rejecting it turns that guess into feedback.

`map` takes an optional **`camera`**, which is how it frames itself when opened:

| `camera` | behaviour |
| --- | --- |
| `"remember"` *(default)* | reopens where the user last left it; frames the markers only on a first-ever open |
| `"fit"` | always frames the current markers, on every change to them |
| `{ center: [lng, lat], zoom }` | always opens at one fixed spot |

The remembered position lives in `ctx.storage` under `map:<pageId>:camera`, so it is the app's own
data and behaves identically for an untrusted app in the isolate. Only moves the *user* made are
recorded — a programmatic re-frame is not a preference.

What `camera` deliberately does **not** cover is anything about *when* the map loads or in what
order it renders. That is host behaviour (`packages/views/src/map.tsx`) and is not reachable from an
app module; see `VIEW_FIELDS` and the Edit-mode contract in `docs/04`.

### `steps` — walk an ordered list

`{ type: "steps", entity, param?, list, text?, onFinish? }`. Renders the ordered `list` field of one
record as a checklist. Progress is persisted per record in `ctx.storage` under
`steps:<pageId>:<recordId>`, so you can leave a half-finished walk-through and come back to it, and
`onFinish` names an action to run once the last step is ticked (once — not every time you reopen a
finished one).

### `checklist` — tick records in place

```ts
{
  type: "checklist", entity: "item",
  done: "bought",                 // a boolean field — or an enum field plus `doneValue: "done"`
  text: "name", detail: "quantity", group: "aisle",   // bindings: a field key or a function
  hideDone: "collapse",           // true: done rows vanish; "collapse": fold into "Done (n)"; default: listed under Done
  quickAdd: true,                 // an input at the bottom: type, Enter, next
  onOpen: { page: "item", param: { itemId: "id" } },
}
```

A grocery list, a packing list, chores, habits: the most common personal app is a list of things
you tick, and `list` made that three taps and a modal (open the row, flip a boolean in the form,
save). Here the row's check flips `done` through `ctx.patch` — rows in, patches out, so it renders
untrusted like every other declarative view — and the row strikes through, holds for a beat, then
moves to the Done section. `steps` ticks *within* one record; this ticks *across* records.
`quickAdd` creates a record with the typed text as the entity's display field and every other field
at its default; the input keeps the focus for the next item. Validation says, by name, when `done`
is not a boolean or an enum, or when `doneValue` is not one of the enum's options.

### Page `summary` — numbers over many records

`computed` is per-record and every view renders rows, so a figure derived from the *whole set* — a
monthly total, a head count, an average — had nowhere to live. A page declares them:

```ts
{
  id: "all", title: "Expenses",
  summary: [
    { label: "Entries", op: "count" },                        // count needs no field
    { label: "Total", field: "amount", op: "sum" },           // sum | avg | max over a field
    { label: "This month", value: (rows, ctx) => ... },       // anything else
  ],
  view: { type: "list", entity: "expense", filters: [...] },
}
```

Two forms, the same pairing as `filters` (declarative chips) and `filter` (a function). Prefer `op`:
it is the only form the structural editor can edit and the only one that ports to another framework,
and per-record arithmetic belongs in a `computed` field you then aggregate. Reach for `value` when
the figure needs a rule the enum cannot express — a date window, say.

Figures are computed over the page's **filtered** rows, so they follow the filter chips. A total that
disagreed with the rows beneath it would read as a bug. The cost is one extra page query per write,
which is fine at personal scale.

It sits on the **page**, not the view: one schema field and one component that works above any view
type, rather than the same option repeated across eight.

### `aggregate` view — a screen folded out of the whole set

```ts
{
  type: "aggregate",
  entity: "expense",
  title: "Who owes whom",
  rows: (rows, ctx) => AggregateRow[],   // { label, value?, detail?, tone?, group? }
}
```

`summary` (above) answers "one number over many records". This answers "**a table** derived from many
records" — who owes whom, what is still to buy, hours per project. Neither is per-record, so neither
belongs in `computed`.

The fold is ordinary TypeScript with no restrictions; what makes it declarative is that it returns
**display-ready data** rather than markup. That is not a stylistic choice: value-returning functions
cross the isolate bridge natively, so an `aggregate` screen renders identically for a trusted app and
for one a friend shared with you. The same screen written as a `custom` view renders **blank** when
untrusted — which is why this view type exists (KA-24, `docs/05`).

Rows sharing a consecutive `group` render under one heading, so "balances" and "settle up" are one
view rather than two pages. `tone` colours a value, but the sign always appears in the text too — the
screen has to be readable in monochrome and to a screen reader.

### `custom` view — the no-ceiling escape hatch

`{ type: "custom", render: (props: ViewProps) => JSX }`. The app ships a real React component
with full `ctx` access via `props.runtime`. This is the ultimate "fully control the app":
when the built-ins don't fit, write the screen yourself. Built-ins exist only to save you from
writing list/table/etc. by hand.

**Reach for `aggregate` first when the screen is a derived table.** A custom view does not render for
an untrusted app, so an app built around one is an app that cannot usefully be shared.

## Reminders (functions)

```ts
reminders: [
  {
    id: "water-due",
    entity: "plant",
    when:  (p) => p.active ? addDays(p.lastWatered, effectiveInterval(p)) : null, // Date|null
    title: (p) => `Water ${p.name}`,
    body:  (p) => `Last watered ${relativeTime(p.lastWatered)}`,
  },
]
```

The runtime reconciles reminders on writes and schedules future ones via
`ctx.caps.notifications` (see docs/07 for platform limits).

## What the runtime does with a module

1. **Load** the module (direct import if trusted; bundle→isolate if untrusted — docs/07).
2. **Validate** the declarative parts (`packages/schema` Zod) — entity/field/view *structure*
   only. Functions are typed by TS at author time; the runtime just calls them.
3. **Run**: resolve records + relations from the `Store`, execute `computed`/`filter`/`sort`
   over the in-memory result set (personal scale → no query DSL, no pushdown planner), invoke
   `actions`/`reminders`, and render views — all with `ctx` injected.

## Why keep structure declarative at all?

Because shape isn't logic. Declaring fields as data is what buys automatic storage columns,
generated forms, validation, view binding, and migrations. It's a schema (like Prisma/Zod),
not a DSL — it never made you hit a wall. The wall was always in *logic*, and logic is now
unrestricted TypeScript.
