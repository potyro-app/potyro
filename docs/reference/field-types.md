---
title: Field types
description: Every field type, its options and the value it stores.
section: reference
order: 2
---

# Field types

A field is `{ type, …options }` inside an entity's `fields`. The set of types is closed: there are
sixteen, and this page lists them all.

```ts
fields: {
  name: { type: "text", required: true, label: "Name" },
  price: { type: "money", currency: "EUR" },
  status: { type: "enum", options: ["todo", "doing", "done"], default: "todo", colors: { done: "green" } },
  due: { type: "datetime" },
  photo: { type: "media" },
  owner: { type: "member" },
  project: { type: "relation", to: "project" },
  steps: { type: "list", of: { text: { type: "text" } }, ordered: true },
}
```

## Common options

Every type takes these.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `label` | `Words` | the key, humanised | The control's label. |
| `required` | `boolean` | `false` | The form refuses to save without a value. |
| `hidden` | `boolean` | `false` | Not shown on the form or the record page. |
| `help` | `Words` | – | One line under the control. |
| `placeholder` | `Words` | – | Example text in the empty control (text, url, number). |
| `width` | `"full" \| "half"` | `"full"` | `half` lets two short neighbours share a row on a wide form. They stack on a phone. |
| `default` | `unknown \| ((ctx: Ctx) => unknown)` | – | The value a new record starts with. A function runs on create. |

Values are checked against their field on `ctx.create` and `ctx.patch`. A value that does not fit
is rejected with a message for the person. A read never returns a value that does not fit.

## Values at a glance

| Type | Stored value | As a function sees it |
|---|---|---|
| `text`, `richtext`, `url` | `string` | `string` |
| `number`, `duration` | `number` | `number` |
| `money` | `number`, whole minor units | `number` |
| `boolean` | `boolean` | `boolean` |
| `enum` | `string`, the option key | `string` |
| `tags` | `string[]` | `string[]` |
| `datetime` | ISO string | `Date` |
| `geo` | `{ lat, lng, label? }` | the same |
| `media` | `MediaRef`, or an array | the same |
| `file` | `FileRef` | the same |
| `relation` | an id, or ids with `many` | the record, or records, resolved one level deep |
| `member` | an account id, or ids with `many` | a `Person`, or people |
| `list` | an array of row objects | the same |

## text

```ts
{ type: "text", multiline: true, collaborative: true }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `multiline` | `boolean` | `false` | A taller box that keeps line breaks. |
| `collaborative` | `boolean` | `false` | Several people type at once. Edited with `ctx.text`, merged character by character. See [Working together](../guides/working-together.md). |

## richtext

```ts
{ type: "richtext" }
```

Formatted text. No options beyond the common ones.

## number

```ts
{ type: "number", min: 0, max: 100, step: 0.5, unit: "kg" }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `min` | `number` | – | The smallest value accepted. |
| `max` | `number` | – | The largest value accepted. |
| `step` | `number` | – | The increment of the control. |
| `unit` | `Words` | – | Shown after the number ("kg", "min"). |
| `integer` | `boolean` | `false` | Whole numbers only. |

## boolean

```ts
{ type: "boolean", default: false }
```

A toggle. No options beyond the common ones.

## money

```ts
{ type: "money", currency: "EUR", min: 0 }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `currency` | `string` | `"EUR"` | ISO 4217. Decides the minor digits: a yen has none. |
| `min` | `number` | – | In minor units. |
| `max` | `number` | – | In minor units. |

The value is whole minor units: `4200` is €42.00 and `5` is ¥5. Never a float. The form takes what a
person writes (`42`, `42,50`) and stores the integer. Format it with `ctx.format.money(minor,
currency)`. A list view shows its first money field per row and totals it unless the view says
`money: false` or names another field.

## enum

```ts
{ type: "enum", options: ["todo", "doing", "done"], colors: { done: "green" }, labels: { todo: "To do" }, control: "picker" }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `options` | `string[]` | required | The option keys. Records store the key. |
| `colors` | `Record<string, EnumColor>` | derived from each name | A colour per option that means something. |
| `labels` | `Record<string, Words>` | the key, humanised | What each option reads as. |
| `control` | `"segmented" \| "picker"` | by option count | Up to five options are a row of buttons. More open a searchable picker. |

`EnumColor` is one of `"red"`, `"orange"`, `"yellow"`, `"green"`, `"teal"`, `"blue"`, `"purple"`,
`"pink"`, `"grey"`. A required enum with no `default` starts on nothing.

## tags

```ts
{ type: "tags", options: ["urgent", "home", "work"] }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `options` | `string[]` | free text | The chips offered. Without it, any typed word becomes a chip. |
| `labels` | `Record<string, Words>` | – | What each option reads as, as for an enum. |

## datetime

```ts
{ type: "datetime", precision: "minute" }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `precision` | `"day" \| "minute"` | `"day"` | `day` is a date with no time, stored at local midnight. `minute` keeps the time too. |

Functions receive a `Date`. Ask for the minute only when the hour matters.

## duration

```ts
{ type: "duration", unit: "min" }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `unit` | `"ms" \| "s" \| "min" \| "h" \| "d"` | – | The unit the stored number counts. |

## url

```ts
{ type: "url" }
```

A link. No options beyond the common ones.

## geo

```ts
{ type: "geo" }
```

A point: `{ lat: number; lng: number; label?: string }`. A map view's `geo` option names one of
these. No options beyond the common ones.

## media

```ts
{ type: "media", accept: "image", multiple: true, full: false }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `accept` | `"image" \| "video" \| "audio" \| "any"` | `"image"` | What the tile takes. |
| `multiple` | `boolean` | `false` | A strip of several, with the add tile last. |
| `full` | `boolean` | `false` | Keep a photo exactly as the camera took it. Off, photos are resized for the screen and their EXIF data is dropped. |

The value is a `MediaRef`: `{ key: string; mime: string; w?: number; h?: number }`. Get a URL for
it with `ctx.media.url(ref)`. Store bytes with `ctx.media.put(blob)`. On a phone the empty tile
offers Camera or Library. Turn `full` on where the pixels are the point: a scanned document, a
receipt to read later.

## file

```ts
{ type: "file", accept: ".md,.txt", folder: "notes" }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `accept` | `string` | any | Extensions the picker offers, comma-separated. |
| `folder` | `string` | the app's root | Where imported files land. |

The value is a `FileRef`: `{ id: string; path?: string; name?: string; mime?: string }`. Build one
from a `FileInfo` returned by `ctx.files`. The `id` never changes; the `path` can. Read the file
with `ctx.files.text(ref)`, `ctx.files.bytes(ref)` or `ctx.files.url(ref)`.

## relation

```ts
{ type: "relation", to: "project", many: true }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `to` | `string` | required | The target entity key. |
| `many` | `boolean` | `false` | Several records. |

Store an id, or an array of ids. When a function reads the record, the relation is resolved one
level deep: `task.project.name` works, `task.project.owner.name` does not. The form is a searchable
picker. When the search finds nothing, its last line creates the record with what was typed. A
relation to the app's `scope` entity defaults to the current selection on create.

## member

```ts
{ type: "member", many: true }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `many` | `boolean` | `false` | Several people. |

A person in the app's space: who paid, who is assigned. Stored as an account id, or ids. Resolved to
a `Person` (`{ id, name, guest? }`), so `expense.paidBy.name` works. A value must name someone in
`ctx.people`: a member of the space, or a guest added with `ctx.guests.add`. In a solo app that is
you. Use `member`, not a relation to your own "person" entity: membership cannot be forged, and no
people table needs keeping in step. "Who entered this record" is `createdBy`, stamped by Potyro,
never a field.

## list

```ts
{ type: "list", of: { quantity: { type: "number" }, unit: { type: "text" }, ingredient: { type: "text" } }, ordered: true, lines: ["quantity", "unit", "ingredient"] }
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `of` | `Record<string, Field>` | required | The fields of one row. |
| `ordered` | `boolean` | `false` | Rows can be dragged into order and read as a numbered list. |
| `lines` | `string[]` | – | Rows read as one line of these parts: "350 g flour". |

The value is an array of row objects. On the form each row is a card: the first sub-field is the line
you read, the rest sit under it. A `steps` view walks an `ordered` list of one record.

## Next

- [Entities and fields](../guides/entities-and-fields.md): choosing fields for an app.
- [defineApp](define-app.md): the entity object these fields sit in.
- [ctx](ctx.md): reading and writing the values.
