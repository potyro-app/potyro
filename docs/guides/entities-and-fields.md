---
title: Entities and fields
description: Declare what an app keeps, choose a type for each field, and arrange the form.
section: guides
order: 1
---

# Entities and fields

This guide declares an entity and its fields, so Potyro can store the records and draw the form.
Everything here is data. Potyro validates it when the app loads and tells you, by name, what is
wrong.

```ts
entities: {
  trip: {
    label: "Trip",
    icon: "map",
    displayField: "name",
    fields: {
      name: { type: "text", required: true, label: "Name", placeholder: "Lisbon, May" },
      start: { type: "datetime", label: "Starts", width: "half" },
      end: { type: "datetime", label: "Ends", width: "half" },
    },
  },
  expense: {
    label: "Expense",
    icon: "receipt",
    displayField: "what",
    fields: {
      what: { type: "text", required: true, label: "What", placeholder: "Dinner at Zé" },
      amount: { type: "money", currency: "EUR", required: true, min: 0, label: "Amount" },
      on: { type: "datetime", label: "Day", default: (ctx) => ctx.today() },
      kind: {
        type: "enum",
        options: ["food", "travel", "stay", "fun"],
        labels: { food: "Food", travel: "Travel", stay: "Stay", fun: "Fun" },
        colors: { food: "orange", travel: "blue", stay: "purple", fun: "pink" },
        default: "food",
        label: "Kind",
      },
      paidBy: { type: "member", label: "Paid by" },
      trip: { type: "relation", to: "trip", required: true, label: "Trip" },
      receipt: { type: "media", accept: "image", label: "Receipt" },
      shared: { type: "boolean", default: true, label: "Split with everyone" },
      note: { type: "text", multiline: true, label: "Note", help: "Anything worth remembering" },
    },
    groups: [
      { fields: ["what", "amount", "on", "kind"] },
      { title: "Who and where", fields: ["paidBy", "trip", "shared"] },
      { title: "More", fields: ["receipt", "note"], collapsible: true },
    ],
  },
}
```

## 1. Name the entity

Give it a key (`expense`), a `label` for people, and an `icon`. The icon is a Lucide name, such as
`"receipt"`. Set `displayField` to the field that names a record. Pickers, row titles and
notifications read that field.

## 2. Choose a type for each field

Every field has a `type`. The type decides the control on the form, how the value is stored and how
a view shows it.

| Type | Use it for |
|---|---|
| `text` | a name, a note (`multiline: true`), a text several people type at once (`collaborative: true`) |
| `richtext` | formatted text |
| `number` | a count or a measure, with `min`, `max`, `step`, `integer`, `unit` |
| `money` | an amount in `currency` |
| `boolean` | a yes or no |
| `enum` | one of a fixed set of `options` |
| `tags` | several words, from `options` or typed freely |
| `datetime` | a day, or a moment with `precision: "minute"` |
| `duration` | a length of time in `unit` |
| `url`, `geo` | a link, a point on a map |
| `media` | a photo, video or audio, by `accept`, one or `multiple` |
| `file` | a file in the app's own folder |
| `relation` | a link `to` another entity, one or `many` |
| `member` | a person in the app's space, one or `many` |
| `list` | nested rows, each with its own fields `of` |

A `money` value is stored in whole minor units: `4200` is €42.00. Format it with
`ctx.format.money`, never by dividing yourself.

A `datetime` is a day unless you ask for the minute. Most dates are days. Ask for the minute only
when the hour matters.

The complete option list is in [Field types](../reference/field-types.md).

## 3. Say what the form needs

Options shared by every type:

- `required: true` blocks saving until the field has a value.
- `default` is a literal, or a function of `ctx`: `(ctx) => ctx.today()`.
- `placeholder` is example text in an empty control. `help` is one line under it.
- `width: "half"` lets two short fields share a row on a wide screen.
- `hidden: true` keeps a field off the form and the record page. Your code still reads and writes
  it.

## 4. Give enum options words and colours

Records keep the option key, `"food"`. People read its label, `"Food"`. `labels` maps one to the
other, and a translation changes only the label.

`colors` tints an option wherever it appears: on the form, as a row badge, on the record page. The
palette is closed: `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `grey`.
Options you leave out get a stable colour from their name.

A few options render as a row of buttons. More open a searchable picker. `control: "segmented"` or
`"picker"` forces either.

## 5. Arrange the form with groups

`groups` orders the fields under headings. The form and the record page read the same list, so what
is entered under "Who and where" is read back under it.

- A group may list computed keys. They show on the record page and the form skips them.
- Fields left out of every group follow the last one, untitled.
- `collapsible: true` lets the heading fold the group. `collapsed: true` starts it folded. The first
  group never folds.

A detail page can override the groups for itself with `sections`. See
[Pages and views](pages-and-views.md).

## 6. Nest rows with a list field

A `list` field holds rows that belong to one record: a recipe's ingredients, a trip's stops.

```ts
stops: {
  type: "list",
  ordered: true,
  lines: ["day", "place"],
  of: {
    day: { type: "number", integer: true, min: 1, label: "Day" },
    place: { type: "text", required: true, label: "Place" },
  },
},
```

`ordered: true` lets the person drag rows into order. `lines` makes each row read as one line of
those sub-fields. Use a `relation` instead when the rows are records of their own that other things
point at.

## Next

- [Pages and views](pages-and-views.md) shows these records as lists, galleries and record pages.
- [Field types](../reference/field-types.md) lists every option of every type.
- [Changing an app that has data](changing-an-app-with-data.md) covers renaming and removing fields
  once records exist.
