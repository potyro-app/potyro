---
title: Pages and views
description: Add pages to an app and choose a built-in view for each, from a list to a record's page, a gallery or a calendar.
section: guides
order: 2
---

# Pages and views

This guide adds pages to an app and picks a built-in view for each one. A page is
`{ id, title, view }`. The view says which entity to show and how.

```ts
pages: [
  {
    id: "expenses",
    title: "Expenses",
    icon: "receipt",
    description: "What the trip cost, newest first.",
    summary: [{ label: "Total", field: "amount", op: "sum" }],
    view: {
      type: "list",
      entity: "expense",
      filters: [{ label: "Search", param: "q", type: "text", placeholder: "What or who" }],
      filter: (e, ctx) => !ctx.params.q || String(e.what).toLowerCase().includes(String(ctx.params.q).toLowerCase()),
      sort: (a, b) => new Date(b.on).getTime() - new Date(a.on).getTime(),
      group: "kind",
      display: {
        primary: "what",
        secondary: (e, ctx) => `${e.paidBy?.name ?? "—"} · ${ctx.format.date(e.on, { dateStyle: "medium" })}`,
        badges: ["kind"],
        media: "receipt",
      },
      rowActions: ["settle"],
      onOpen: { page: "expense", param: { expenseId: "id" } },
      emptyText: "Nothing spent yet. Add the first expense.",
    },
  },
  {
    id: "expense",
    title: "Expense",
    hidden: true,
    view: {
      type: "detail",
      entity: "expense",
      param: "expenseId",
      cover: "banner",
      facts: ["kind"],
      primaryAction: "settle",
      actions: ["move"],
      sections: [
        { fields: ["amount", "on", "paidBy", "trip", "shared"] },
        { title: "Receipt and notes", fields: ["receipt", "note"], collapsible: true },
      ],
    },
  },
  { id: "receipts", title: "Receipts", view: { type: "gallery", entity: "expense", display: { media: "receipt", primary: "what" }, aspect: "square" } },
  { id: "when", title: "Calendar", view: { type: "calendar", entity: "expense", date: "on", title: "what", color: "kind" } },
]
```

## 1. Add a page

Give it an `id`, a `title` and an `icon`. The shell draws the navigation. `description` is one
line under the title and the words on an empty page.

A page with `hidden: true` has no tab. People reach it from a row's `onOpen` or from
`ctx.navigate(pageId, params)`. Record pages are usually hidden.

## 2. Show records as a list

- `filter` is a function of the record and `ctx`. It returns `true` to show a row.
- `filters` adds chips above the rows. Each chip writes into `ctx.params[param]`, and your `filter`
  reads it. A `type: "text"` chip is a search box. `from` naming an enum field makes its options
  chips.
- `sort` orders two rows, like an array comparator.
- `display` picks what a row shows: `primary`, `secondary`, `badges`, a `media` field for the
  picture, an `icon`. Each is a field key, a computed key or a function.
- `group` puts rows under headings per value. `collapsible: true` folds them.
- `rowActions` names entity actions as buttons on each row.
- `onOpen` says where a tap goes: a page, with `param` mapping the page's param to a field. Or a
  function `(record, ctx) => …`.
- `emptyText` shows when the filter leaves nothing.

## 3. Give a record its own page

`detail` shows one record. `param` names the route param that carries the id. The list's `onOpen`
sets it: `{ page: "expense", param: { expenseId: "id" } }`.

- `sections` overrides the entity's `groups` for this page. A section lists `fields`, or shows
  `related` records: `{ entity: "payment", via: "expense", view: "timeline", date: "on" }`.
- `actions` lists action keys as quiet buttons. `primaryAction` is the one big button.
- `cover` places the picture: `"banner"`, `"full"`, `"background"`, `"band"` or `"none"`. `media`
  names the picture field. `facts` are fields shown as chips on the cover.

## 4. Pick another view when a list does not fit

| View | Shows |
|---|---|
| `gallery` | cards led by a picture, with `aspect` and `caption` |
| `calendar` | records on their `date`, titled and coloured by a field |
| `timeline` | records on a rail by `date`, grouped by day, week or month |
| `board` | columns by an enum `column`, cards dragged between them |
| `checklist` | rows you tick, flipping a boolean or enum `done` field |
| `table` | `display.columns` of fields |
| `map` | pins at a `geo` field |
| `steps` | one record's ordered `list` walked step by step |
| `stats`, `chart` | figures and bars folded from the page's rows |
| `aggregate` | a table your function folds from all rows, such as who owes whom |
| `custom` | a screen you draw yourself, see [Custom views](custom-views.md) |

Every option of every view is in [Pages and view options](../reference/pages-and-views.md).

## 5. Put figures above the view

`summary` on the page shows numbers over the page's filtered rows. Use `op` with a `field`:
`"sum"`, `"avg"`, `"max"`, or `"count"` with no field. Use `value: (rows, ctx) => …` when the
rule is more than an aggregate, such as a date window.

The figures follow the filter chips, so they always agree with the rows below.

## 6. Put several views on one page

Declare `layout` instead of `view`. Each item is an ordinary view with a `title`.

```ts
{
  id: "today",
  title: "Today",
  layout: {
    type: "grid",
    items: [
      { title: "Unsettled", span: 2, view: { type: "list", entity: "expense", filter: (e) => !e.settled } },
      { title: "By kind", span: 1, view: { type: "chart", entity: "expense", series: (rows) => byKind(rows) } },
    ],
  },
}
```

`stack` is a column. `grid` lays items out by `span`, one column on a phone. `split` is a list on
the left filling a detail on the right. `tabs` shows one item at a time.

## 7. Give the app a live tile

`tile` on the app returns what the launcher shows while the app is closed. It returns plain
values, never markup.

```ts
tile: async (ctx) => {
  const open = (await ctx.query("expense")).filter((e) => !e.settled);
  return {
    count: open.length,
    title: ctx.t("{n, plural, =0 {All settled} one {# to settle} other {# to settle}}", { n: open.length }),
    lines: open.slice(0, 3).map((e) => String(e.what)),
  };
},
```

A tile that throws or returns nothing shows the app's plain face.

## Next

- [Computed, actions and reminders](computed-actions-reminders.md) adds the `settle` and `move`
  actions these pages name.
- [Pages and view options](../reference/pages-and-views.md) lists every view and option.
- [Custom views](custom-views.md) is for the screen no built-in view draws.
