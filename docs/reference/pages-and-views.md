---
title: Pages and view options
description: The page object, the options every view shares, and every view type with its options.
section: reference
order: 3
---

# Pages and view options

A page is `{ id, title, view }` plus presentation options. Its `view` is one of fourteen view
types, or a `layout` of several.

```ts
pages: [
  {
    id: "all",
    title: "Recipes",
    icon: "chef-hat",
    description: "Everything you cook",
    summary: [{ label: "Recipes", op: "count" }],
    view: {
      type: "list",
      entity: "recipe",
      sort: (a, b) => a.name.localeCompare(b.name),
      display: { primary: "name", secondary: (r) => `${r.minutes} min`, media: "photo" },
      filters: [{ label: "Search", param: "q", type: "text" }],
      filter: (r, ctx) => !ctx.params.q || r.name.toLowerCase().includes(String(ctx.params.q).toLowerCase()),
      rowActions: ["cook"],
      onOpen: { page: "recipe", param: { id: "id" } },
    },
  },
  { id: "recipe", title: "Recipe", hidden: true, view: { type: "detail", entity: "recipe", param: "id" } },
]
```

Views are validated strictly. An unknown key is an error.

## Page

| Option | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | required | Named by `onOpen`, `navigate` and links. |
| `title` | `Dynamic<Words>` | required | The tab label. A function of `ctx` may name the selection. |
| `description` | `Words` | – | One sentence where pages are listed, and under an empty page's heading. |
| `icon` | `string` | the entity's | A Lucide name. |
| `hidden` | `boolean` | `false` | Not in the navigation. Reached by tapping a row or by `navigate`. |
| `view` | `View` | one of the two | The page's view. |
| `layout` | `PageLayout` | one of the two | Several views on one page. |
| `summary` | `SummaryValue[]` | – | Figures above the view, over the page's filtered rows. |
| `actions` | `PageAction[]` | – | Buttons in the page's chrome, beside the filter chips. |
| `primaryAction` | `string \| number` | – | A quick action's `id` or an `actions` index: a bar at the bottom. The page then has no floating Add. |
| `add` | `number` | – | The `actions` index that adds what the page shows. The "+" runs it instead of the form. |
| `background` | `Backdrop` | `theme.background` | This page's ground. |
| `fullscreen` | `boolean` | `false` | No bars. For a game or a slideshow. |
| `link` | `{ params?: string[] }` | – | The `ctx.params` a share link may set on this page. Anything else in a link is dropped. |

### Dynamic

```ts
type Dynamic<T> = T | ((ctx: Ctx) => T | Promise<T>);
```

An option marked `Dynamic` takes a literal or a function of `ctx`. The function runs each time the
view opens, and again when `ctx.scope` changes.

### SummaryValue

```ts
summary: [
  { label: "Entries", op: "count" },
  { label: "Total", field: "amount", op: "sum" },
  { label: "This month", value: (rows, ctx) => rows.filter((r) => isThisMonth(r.date, ctx)).length },
]
```

| Option | Type | Meaning |
|---|---|---|
| `label` | `Words` | Omit when the value is its own sentence. |
| `field` | `string` | The field or computed to aggregate. Not needed for `count`. |
| `op` | `"sum" \| "count" \| "avg" \| "max"` | The aggregate. |
| `value` | `(rows: Resolved[], ctx: Ctx) => unknown` | Full control, instead of `op`. |

### PageAction

```ts
actions: [{ label: "Centre on me", icon: "locate", run: async (ctx) => { /* … */ }, when: (rows) => rows.length > 0 }]
```

| Option | Type | Meaning |
|---|---|---|
| `label` | `Words` | The button text. |
| `icon` | `string` | A Lucide name. |
| `run` | `(ctx: Ctx) => void \| Promise<void>` | What it does. No record: a page is not a record. |
| `when` | `(rows: Resolved[], ctx: Ctx) => boolean \| Promise<boolean>` | Show it only when it applies. |

### Layout

```ts
layout: {
  type: "grid",
  items: [
    { title: "Due", span: 1, view: { type: "aggregate", entity: "plant", rows: dueRows } },
    { title: "All", span: 2, view: { type: "list", entity: "plant" } },
  ],
}
```

| Option | Type | Meaning |
|---|---|---|
| `type` | `"stack" \| "grid" \| "split" \| "tabs"` | `stack`: a column. `grid`: columns by `span`, stacking on a phone. `split`: two items, a list whose rows fill the detail beside it. `tabs`: one item at a time. |
| `items` | `LayoutItem[]` | Each `{ view, title?, span?, collapsible? }`. |

`span` is 1 to 3 columns in a `grid`. `collapsible` folds a `stack` item behind its title.
`ctx.params` are the page's, shared by every item. The page's `summary` and filter chips read the
first item.

## Options views share

| Option | Type | Views | Meaning |
|---|---|---|---|
| `entity` | `string` | all | The records shown. |
| `filter` | `(record, ctx) => boolean` | most | Which records. Reads `ctx.params` and `ctx.scope`. |
| `sort` | `(a, b, ctx) => number` | most | Their order. |
| `filters` | `FilterChip[]` | list, gallery, map, checklist | Chips in the chrome that write `ctx.params`. |
| `display` | `ListDisplay` | list, gallery, board, timeline, map, related | What a row shows. |
| `onOpen` | `OnOpen` | rows, cards, pins | Where a tap goes. |
| `rowActions` | `string[]` | list, checklist | Action keys offered on a row. |
| `param` | `string` | detail, steps, custom, aggregate | The `ctx.params` key that carries the record id. |
| `group` | `Binding` | list, gallery, table, checklist | Rows under a heading per value. |
| `collapsible` | `boolean` | list, gallery, table | Headings fold their groups. Needs `group`. |
| `emptyText` | `Dynamic<Words>` | list, gallery, checklist, timeline, aggregate, chart | Shown with no rows. |

### ListDisplay

| Option | Type | Default | Meaning |
|---|---|---|---|
| `primary` | `Binding` | the display field | The main line. |
| `secondary` | `Binding` | – | A quieter second line. |
| `icon` | `Binding` | – | A Lucide name per record: the row's lead, the map's pin. |
| `media` | `string` | the entity's first photo field | The media field shown. |
| `badges` | `string[]` | – | Fields shown as chips. |
| `lead` | `"monogram" \| "icon" \| "none"` | `"monogram"` | What leads a row with no photo. |

### OnOpen

```ts
type OnOpen = { page: string; param?: Record<string, string> } | ((record: Resolved, ctx: Ctx) => void | Promise<void>);
```

A page, with `param` mapping each target param to a source field key, or the app's own function.

### FilterChip

```ts
filters: [
  { label: "Search", param: "q", type: "text", placeholder: "Name or aisle" },
  { label: "Trip", param: "trip", from: "trip" },
  { label: "Near me", param: "me", type: "geo" },
]
```

| Option | Type | Meaning |
|---|---|---|
| `label` | `Words` | The chip's text. |
| `param` | `string` | The `ctx.params` key it writes. |
| `type` | `"boolean" \| "geo" \| "text" \| "number"` | A toggle, a "use my location" button (`{ lat, lng }`), a search box (`string`), or a number box. |
| `from` | `string` | An enum or tags field: its options as chips. An entity: one chip per record, the param holds the selected ids. |
| `multi` | `boolean` | Several options at once. |
| `placeholder` | `Words` | The hint inside a text or number box. |

A chip only collects a value. The view's `filter` decides what matching means.

## list

| Option | Type | Default | Meaning |
|---|---|---|---|
| `money` | `string \| false` | the first money field | The field shown per row and totalled. `false`: none. |

## gallery

| Option | Type | Default | Meaning |
|---|---|---|---|
| `aspect` | `"square" \| "portrait" \| "landscape"` | `"landscape"` | The card's shape. |
| `caption` | `"below" \| "over"` | `"below"` | Words under the picture, or on it. |

## table

| Option | Type | Meaning |
|---|---|---|
| `display` | `{ columns: string[] }` | The columns, as field or computed keys. |

Plus `filter`, `sort`, `group`, `collapsible`.

## detail

```ts
{
  type: "detail", entity: "exercise", param: "id",
  cover: "full", media: "art", facts: ["muscle", "level"],
  primaryAction: "start", actions: ["logSet", { label: "History", navigate: { page: "history", param: { id: "id" } } }],
  sections: [
    { title: "Plan", fields: ["sets", "reps"], collapsible: true },
    { title: "Log", related: { entity: "set", via: "exercise", view: "chart", date: "when", value: "kg", by: "week" } },
  ],
}
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `param` | `string` | – | The `ctx.params` key holding the record id. |
| `sections` | `DetailSection[]` | the entity's `groups` | What the page shows, in order. |
| `actions` | `DetailAction[]` | – | Action keys, or `{ label, navigate: { page, param? } }`. |
| `primaryAction` | `DetailAction` | – | The one thing the page is for: a bar at the bottom. |
| `media` | `string \| false` | the first photo field | The cover's picture: a media field, or a computed returning a path in `ctx.files`. |
| `cover` | `"banner" \| "full" \| "background" \| "band" \| "none"` | `banner` with a picture, `band` without | How the cover is drawn. |
| `facts` | `string[]` | its enum fields | Fields as chips on the cover. |

A `DetailSection` is `{ title?, fields?, related?, collapsible?, collapsed? }`. `collapsed` starts it
folded and implies `collapsible`. A `related` section lists the records that point at this one:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `entity` | `string` | required | Their entity. |
| `via` | `string` | required | Their relation field that points at this record. |
| `view` | `"list" \| "timeline" \| "chart"` | `"list"` | `timeline` and `chart` need `date`. |
| `display` | `ListDisplay` | – | What a row shows. |
| `date` | `string` | – | Their date field. |
| `value` | `string` | counts | Chart: the number field summed per bar. |
| `by` | `"day" \| "week" \| "month"` | `"week"` | Chart bars. |
| `limit` | `number` | 20 | Newest first, at most this many. |
| `onOpen` | `OnOpen` | – | Where a row goes. |

## calendar

| Option | Type | Meaning |
|---|---|---|
| `date` | `Binding` | required. The date of each record. |
| `title` | `Binding` | The event's text. |
| `color` | `Binding` | Its colour. |
| `filter` | `FilterFn` | Which records. |

## map

| Option | Type | Default | Meaning |
|---|---|---|---|
| `geo` | `string` | required | The geo field. |
| `title` | `Binding` | – | The pin's popup text. |
| `color` | `Binding` | – | The pin's colour. |
| `camera` | `Dynamic<MapCamera>` | `"remember"` | `"remember"` reopens where the person left it. `"fit"` frames the pins. `{ center: [lng, lat], zoom }` opens at one spot. |
| `locate` | `boolean` | `true` where the device can | The "centre on me" button. |
| `strip` | `boolean` | `false` | The records in view as cards along the bottom, nearest first. |
| `onOpen` | `OnOpen` | – | Where a tapped pin goes. Without it, a pin only shows its title. |
| `onSelect` | `(record, ctx) => void \| Promise<void>` | – | A pin or strip card tapped. |

Plus `filter`, `filters`, `display`. The camera is read once, when the view opens. Move the map
later with `ctx.views.map(pageId)`.

## steps

| Option | Type | Meaning |
|---|---|---|
| `param` | `string` | The `ctx.params` key holding the record id. |
| `list` | `string` | required. The ordered list field to walk. |
| `text` | `Binding` | How one step renders: a sub-field key, or a function over the step. |
| `onFinish` | `string` | The action key run once every step is ticked. |

Progress is kept per record, so a half-finished walk-through resumes.

## checklist

```ts
{
  type: "checklist", entity: "item", done: "bought",
  text: "name", detail: "quantity", group: "aisle", hideDone: "collapse",
  quickAdd: { remember: ["aisle"], defaults: (text) => (/milk|cheese/i.test(text) ? { aisle: "dairy" } : {}) },
  reorder: "position",
}
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `done` | `string` | required | The boolean field a tick flips, or an enum field with `doneValue`. |
| `doneValue` | `string` | – | For an enum `done`: the option that means done. |
| `text` | `Binding` | the display field | The row's label. |
| `detail` | `Binding` | – | A quieter second line. |
| `group` | `Binding` | – | Rows under a heading per value. |
| `hideDone` | `boolean \| "collapse"` | listed under "Done" | `true`: done rows disappear. `"collapse"`: they fold into a section. |
| `doneLabel` | `Words` | "Done" | The folded section's heading. |
| `strike` | `boolean` | `true` | Strike a ticked row through. |
| `donePlacement` | `"stay" \| "sink"` | `"stay"` | `sink` moves a ticked row to the bottom of its group. |
| `quickAdd` | `boolean \| ChecklistQuickAdd` | `false` | An input at the bottom: type, Enter, next. |
| `icon` | `Binding` | – | A Lucide name per item. |
| `layout` | `"rows" \| "tiles"` | `"rows"` | Tiles are a grid of big tappable items. |
| `editText` | `boolean` | `false` | Tap a row's text to rename it in place. |
| `reorder` | `string` | – | The number field holding a row's position. With it, rows drag. |
| `groupOrder` | `string` | – | When `group` is a relation: the number field on that entity holding a group's position. Groups can then be renamed, reordered, deleted and added. |

Plus `filter`, `sort`, `filters`, `rowActions`, `onOpen`, `emptyText`. `ChecklistQuickAdd` is:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `suggest` | `boolean` | `true` | Offer earlier items as you type. |
| `remember` | `string[]` | – | Fields copied from the last item with the same text. |
| `defaults` | `(text, ctx) => Record<string, unknown>` | – | The new item's other fields, from what was typed. |
| `usuals` | `(rows, ctx) => string[]` | – | Texts the empty box offers as one-tap chips. |

## board

| Option | Type | Default | Meaning |
|---|---|---|---|
| `column` | `string` | required | The enum field whose options are the columns. |
| `columns` | `string[]` | all options | Which options, in order. |
| `allowMove` | `boolean` | `true` | `false` makes the board read-only. |

Plus `display`, `filter`, `sort`, `onOpen`. Dragging a card, or its Move to, patches `column`.

## timeline

| Option | Type | Default | Meaning |
|---|---|---|---|
| `date` | `Binding` | required | A date field, or a function returning a `Date`. |
| `color` | `string` | – | An enum field. Each dot wears its option's colour. |
| `groupBy` | `"day" \| "week" \| "month"` | `"day"` | The sticky headings. |
| `newest` | `"first" \| "last"` | `"first"` | The direction. |

Plus `display`, `filter`, `onOpen`, `emptyText`.

## stats

```ts
{
  type: "stats", entity: "session",
  items: [
    { label: "Sessions", op: "count", compare: { value: (rows) => lastWeek(rows).length, label: "last week" } },
    { label: "Lifted", field: "kg", op: "sum", unit: "kg" },
  ],
}
```

| Option | Type | Meaning |
|---|---|---|
| `items` | `StatItem[]` | The tiles. |
| `filter` | `FilterFn` | Which records. |

A `StatItem` is a `SummaryValue` with a required `label` and an optional `unit` (`Words`). It may
add `compare: { value: (rows, ctx) => unknown; label: Words; as?: "difference" | "percent" }`. The
tile then reads "1 more than last week" or, with `as: "percent"`, "6% less than last week".

## chart

| Option | Type | Meaning |
|---|---|---|
| `series` | `(rows: Resolved[], ctx: Ctx) => ChartPoint[] \| Promise<ChartPoint[]>` | required. The bars. |
| `title` | `Dynamic<Words>` | Heading. |
| `subtitle` | `Dynamic<Words>` | Under it. |
| `filter` | `FilterFn` | Which records. |
| `emptyText` | `Dynamic<Words>` | With no points. |

A `ChartPoint` is `{ label: string; value: number; text?: string }`.

## aggregate

```ts
{
  type: "aggregate", entity: "expense", title: "Who owes whom",
  rows: (rows, ctx) => settle(rows, ctx.people).map((t) => ({
    label: `${t.from.name} → ${t.to.name}`, value: ctx.format.money(t.minor, "EUR"), tone: "negative",
    action: { entity: "expense", id: t.id, key: "settle" },
  })),
}
```

| Option | Type | Meaning |
|---|---|---|
| `param` | `string` | The `ctx.params` key holding a record id. |
| `rows` | `(rows: Resolved[], ctx: Ctx) => AggregateRow[] \| Promise<AggregateRow[]>` | required. Fold the page's rows into display-ready rows. |
| `title` | `Dynamic<Words>` | Heading above the table. |
| `emptyText` | `Dynamic<Words>` | When the fold returns nothing. |

An `AggregateRow`:

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | Stable identity. Falls back to `label`. |
| `label` | `string` | required. The row's subject. |
| `value` | `string \| number` | At the end of the row. |
| `detail` | `string` | A quieter second line. |
| `tone` | `"positive" \| "negative" \| "neutral"` | Colours the value. Put the sign in the text too. |
| `group` | `string` | Consecutive rows sharing one sit under a heading. |
| `record` | `{ entity, id }` | Tapping opens that record. |
| `open` | `{ page, params? }` | Tapping opens that page. |
| `action` | `{ entity, id, key, label?, input? }` | A button that runs an entity action on a record. |

An aggregate renders the same in a shared app, because it returns data, not markup.

## custom

```ts
{ type: "custom", entity: "recipe", param: "id", render: (props) => <CookAlong {...props} />, onFinish: "markCooked" }
```

| Option | Type | Meaning |
|---|---|---|
| `param` | `string` | The `ctx.params` key holding a record id. |
| `render` | `(props: ViewProps) => ReactElement` | A React component. |
| `mount` | `(el: HTMLElement, props: ViewProps) => () => void` | Any framework: fill `el`, return a teardown. |
| `onFinish` | `string` | An action key the view may run when done. |

Declare `render` or `mount`. `ViewProps` is listed in [ctx](ctx.md). See [Custom
views](../guides/custom-views.md).

## Next

- [Pages and views](../guides/pages-and-views.md): choosing a view for a screen.
- [defineApp](define-app.md): the page list's place in the app.
- [ctx](ctx.md): `ctx.params`, `ctx.scope` and `ctx.views`, which views read and write.
